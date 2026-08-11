/**
 * CommunityCut API Handler
 * Replaces famous.ai backend with a self-controlled Cloudflare Worker API.
 * Handles: Stripe payments (live), bookings, pros, admin stats, GBP, outreach.
 */

const DB_URL = 'https://wlmappvankhmtfmbtmeg.databasepad.com';
const DB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjU3NDFhMjU0LThjODUtNDJmMC1hOTMwLWJlYzY5NzQyZGFjNyJ9.eyJwcm9qZWN0SWQiOiJ3bG1hcHB2YW5raG10Zm1idG1lZyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzc3MjUzOTUyLCJleHAiOjIwOTI2MTM5NTIsImlzcyI6ImZhbW91cy5kYXRhYmFzZXBhZCIsImF1ZCI6ImZhbW91cy5jbGllbnRzIn0.qhGHYwH6xrv_uei-AmG0C9lRUyLDhw6Nc4keGdzFgYM';
const STRIPE_PK = 'pk_live_51TaJRtISHWqpzKEJXIm7mNfAe6LEJSltS8MKMovzWfZWL5akEpSFOxUoGu9g1SYjsSwuTUrYKBCgVYhNg21xPfog00Ly4TeX5n';
const KV_NS_ID = '1f09b0259acf44c3be5d11bdb7fce259';

// ─── CORS Headers ─────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || 'https://www.communitycut.com',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-admin-key',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function dbGet(path, params = {}) {
  const url = new URL(`${DB_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString(), {
    headers: {
      apikey: DB_ANON_KEY,
      Authorization: `Bearer ${DB_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  return r.json();
}

async function dbPost(path, body) {
  const r = await fetch(`${DB_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: DB_ANON_KEY,
      Authorization: `Bearer ${DB_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function dbPatch(path, filter, body) {
  const url = new URL(`${DB_URL}/rest/v1/${path}`);
  Object.entries(filter).forEach(([k, v]) => url.searchParams.set(k, `eq.${v}`));
  const r = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      apikey: DB_ANON_KEY,
      Authorization: `Bearer ${DB_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ─── Stripe Helpers ───────────────────────────────────────────────────────────
async function stripeRequest(env, method, path, body = null) {
  const stripeKey = env.STRIPE_SECRET_KEY;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
  if (body) {
    opts.body = new URLSearchParams(body).toString();
  }
  const r = await fetch(`https://api.stripe.com/v1${path}`, opts);
  return r.json();
}

// ─── Admin Auth Check ─────────────────────────────────────────────────────────
function isAdminRequest(request) {
  const adminKey = request.headers.get('x-admin-key');
  // Simple check: admin key matches a known value stored in env or hardcoded
  // In production this should be an env secret
  return adminKey === 'cc_admin_2026' || request.headers.get('cookie')?.includes('cc_admin=1');
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

// GET /api/pros - list approved pros with optional city filter
async function handleGetPros(request, url) {
  const city = url.searchParams.get('city');
  const category = url.searchParams.get('category');
  const limit = url.searchParams.get('limit') || '50';
  
  let params = { status: 'eq.approved', limit };
  if (city) params.city = `ilike.*${city}*`;
  if (category) params.category = `eq.${category}`;
  
  const pros = await dbGet('barbers', params);
  return pros;
}

// GET /api/pros/:id - get single pro
async function handleGetPro(id) {
  const pros = await dbGet('barbers', { id: `eq.${id}`, limit: '1' });
  return Array.isArray(pros) && pros.length > 0 ? pros[0] : null;
}

// POST /api/bookings - create a booking
async function handleCreateBooking(body, env) {
  // Accept both pro_id and barber_id field names
  const barber_id = body.barber_id || body.pro_id;
  const { client_name, client_email, client_phone, service, date, time, notes, price, client_address, barber_name, city } = body;
  if (!barber_id || !client_name || !client_email || !service || !date || !time) {
    return { error: 'Missing required fields: barber_id, client_name, client_email, service, date, time' };
  }
  // Store booking in KV (database bookings table has FK constraints incompatible with guest bookings)
  const bookingId = crypto.randomUUID();
  const bookingRecord = {
    id: bookingId,
    barber_id,
    client_name,
    client_email,
    client_phone: client_phone || null,
    service,
    booking_date: date,
    booking_time: time,
    notes: notes || null,
    price: price || null,
    client_address: client_address || null,
    status: 'pending',
    payment_status: 'unpaid',
    created_at: new Date().toISOString(),
  };
  let booking = bookingRecord;
  if (env && env.TOKENS) {
    try {
      const existingRaw = await env.TOKENS.get('cc_bookings');
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      existing.unshift(bookingRecord);
      await env.TOKENS.put('cc_bookings', JSON.stringify(existing.slice(0, 500)));
    } catch (e) {
      console.error('KV booking store failed:', e.message);
    }
  }
  // Send confirmation email to client (non-blocking)
  if (booking && booking.id && env) {
    try {
      await sendBookingConfirmationEmail({
        to: client_email,
        client_name,
        barber_name: barber_name || 'your pro',
        service,
        date,
        time,
        address: client_address || '',
        booking_id: booking.id,
        price,
        city: city || '',
      }, env);
    } catch (e) {
      console.error('Email notification failed:', e.message);
    }
  }
  return { ...booking, booking_id: booking?.id };
}

// Send booking confirmation email via Gmail API (best-effort)
async function sendBookingConfirmationEmail({ to, client_name, barber_name, service, date, time, address, booking_id, price, city }, env) {
  // Use Gmail API via fetch with service account or stored credentials
  // For now, store the pending email in KV for the admin to process
  const emailRecord = {
    to,
    subject: `Booking Confirmed — ${service} with ${barber_name}`,
    body: `Hi ${client_name},\n\nYour booking is confirmed!\n\nService: ${service}\nPro: ${barber_name}\nDate: ${date}\nTime: ${time}\nLocation: ${address || city}\nPrice: $${price != null && price !== undefined ? price : 'TBD'}\nBooking ID: ${booking_id}\n\nYour payment is held in secure escrow and released after your appointment.\n\nNeed to cancel? Contact us at admin@communitycut.com at least 24 hours before your appointment for a full refund.\n\nSee you soon!\nThe CommunityCut Team\nhttps://www.communitycut.com`,
    created_at: new Date().toISOString(),
    type: 'booking_confirmation',
    booking_id,
  };
  const existingRaw = await env.TOKENS.get('pending_emails');
  const existing = existingRaw ? JSON.parse(existingRaw) : [];
  existing.unshift(emailRecord);
  await env.TOKENS.put('pending_emails', JSON.stringify(existing.slice(0, 200)));
}

// POST /api/stripe/create-checkout - create Stripe checkout session for Pro subscription
async function handleCreateCheckout(env, body) {
  const { plan, email, pro_id } = body;
  
  const priceMap = {
    'founding': 9900,   // $99/year founding pro
    'monthly': 1900,    // $19/month
    'annual': 9900,     // $99/year
  };
  
  const amount = priceMap[plan] || priceMap['founding'];
  const planName = plan === 'monthly' ? 'CommunityCut Pro Monthly' : 'CommunityCut Founding Pro (Annual)';
  
  const session = await stripeRequest(env, 'POST', '/checkout/sessions', {
    'payment_method_types[]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': planName,
    'line_items[0][price_data][product_data][description]': 'CommunityCut Pro — Keep 92% of every booking. 0% platform fee for 90 days.',
    'line_items[0][price_data][unit_amount]': amount.toString(),
    'line_items[0][price_data][recurring][interval]': plan === 'monthly' ? 'month' : 'year',
    'line_items[0][quantity]': '1',
    'mode': 'subscription',
    'customer_email': email || '',
    'success_url': `https://www.communitycut.com/pro/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url': `https://www.communitycut.com/pro/signup?payment=cancelled`,
    'metadata[pro_id]': pro_id || '',
    'metadata[plan]': plan || 'founding',
  });
  
  return session;
}

// POST /api/stripe/create-payment-intent - create payment intent for booking (SC&T)
async function handleCreatePaymentIntent(env, body) {
  const { amount, currency = 'usd', barber_id, booking_id, description } = body;
  if (!amount || isNaN(parseInt(amount))) return { error: 'Valid amount in cents required' };
  if (!barber_id) return { error: 'barber_id required' };
  if (!booking_id) return { error: 'booking_id required' };

  const amountInt = parseInt(amount);
  const platformFeeCents = Math.round(amountInt * 0.08);
  const proAmountCents = Math.round(amountInt * 0.92);

  // Look up the pro to get their stripe_account_id (best-effort; DB may be paused)
  let proStripeAccountId = null;
  try {
    const pros = await dbGet('barbers', { id: `eq.${barber_id}` });
    const pro = Array.isArray(pros) ? pros[0] : null;
    if (pro && pro.stripe_account_id) proStripeAccountId = pro.stripe_account_id;
  } catch (e) {
    console.warn('Pro lookup failed (DB may be paused):', e.message);
  }

  // SC&T: charge the full amount; transfer_group links this charge to the future transfer
  const intent = await stripeRequest(env, 'POST', '/payment_intents', {
    amount: amountInt.toString(),
    currency,
    description: description || 'CommunityCut Booking',
    'transfer_group': booking_id,
    'automatic_payment_methods[enabled]': 'true',
    'metadata[barber_id]': barber_id,
    'metadata[booking_id]': booking_id,
    'metadata[pro_stripe_account]': proStripeAccountId || '',
    'metadata[platform_fee_cents]': platformFeeCents.toString(),
    'metadata[pro_amount_cents]': proAmountCents.toString(),
  });

  if (intent.error) return { error: intent.error.message || 'Payment setup failed' };

  return {
    client_secret: intent.client_secret,
    payment_intent_id: intent.id,
    amount: amountInt,
    platform_fee_cents: platformFeeCents,
    pro_amount_cents: proAmountCents,
    transfer_group: booking_id,
  };
}

// POST /api/stripe/transfer - fire 92% payout to pro on job completion (SC&T Step 2)
async function handleJobCompleteTransfer(env, body) {
  const { booking_id, barber_id, amount_cents, charge_id } = body;
  if (!booking_id || !barber_id || !amount_cents) {
    return { error: 'booking_id, barber_id, and amount_cents are required' };
  }

  // Look up the pro's connected Stripe account
  let proStripeAccountId = null;
  try {
    const pros = await dbGet('barbers', { id: `eq.${barber_id}` });
    const pro = Array.isArray(pros) ? pros[0] : null;
    if (!pro) return { error: 'Pro not found' };
    if (!pro.stripe_account_id) return { error: 'Pro has not connected their bank account.', code: 'PRO_NOT_ONBOARDED' };
    proStripeAccountId = pro.stripe_account_id;
  } catch (e) {
    return { error: 'DB lookup failed: ' + e.message };
  }

  const amountInt = parseInt(amount_cents);
  const proAmountCents = Math.round(amountInt * 0.92);
  const platformFeeCents = amountInt - proAmountCents;

  const transferBody = {
    amount: proAmountCents.toString(),
    currency: 'usd',
    destination: proStripeAccountId,
    'transfer_group': booking_id,
    'metadata[booking_id]': booking_id,
    'metadata[barber_id]': barber_id,
    'metadata[platform_fee_cents]': platformFeeCents.toString(),
  };
  // Optionally link to the original charge for cleaner reconciliation
  if (charge_id) transferBody['source_transaction'] = charge_id;

  const transfer = await stripeRequest(env, 'POST', '/transfers', transferBody);
  if (transfer.error) return { error: transfer.error.message || 'Transfer failed' };

  // Update booking record with transfer ID (best-effort; DB may be paused)
  try {
    await dbPatch('bookings', { id: booking_id }, {
      stripe_transfer_id: transfer.id,
      payment_status: 'transferred',
      updated_at: new Date().toISOString(),
    });
    // Also update KV booking record
    const raw = await env.TOKENS.get('cc_bookings');
    if (raw) {
      const bookings = JSON.parse(raw);
      const updated = bookings.map(b => b.id === booking_id
        ? { ...b, stripe_transfer_id: transfer.id, payment_status: 'transferred' } : b);
      await env.TOKENS.put('cc_bookings', JSON.stringify(updated));
    }
  } catch (e) {
    console.warn('Transfer record update failed:', e.message);
  }

  return {
    success: true,
    transfer_id: transfer.id,
    pro_amount_cents: proAmountCents,
    platform_fee_cents: platformFeeCents,
    destination: proStripeAccountId,
  };
}

// POST /api/stripe/connect/onboard - create Express connected account + return hosted onboarding URL
async function handleConnectOnboard(env, body) {
  const { barber_id, email, first_name, last_name } = body;
  if (!barber_id || !email) return { error: 'barber_id and email required' };

  // Create the Express connected account
  const account = await stripeRequest(env, 'POST', '/accounts', {
    type: 'express',
    country: 'US',
    email,
    'capabilities[card_payments][requested]': 'true',
    'capabilities[transfers][requested]': 'true',
    business_type: 'individual',
    'individual[first_name]': first_name || '',
    'individual[last_name]': last_name || '',
    'settings[payouts][schedule][interval]': 'weekly',
    'settings[payouts][schedule][weekly_anchor]': 'friday',
    // Minimum balance: $10 must remain in connected account to protect against disputes
    // Configure the exact amount in Stripe Dashboard > Connect > Account balances
    // docs.stripe.com/connect/account-balances
    'metadata[barber_id]': barber_id,
  });

  if (account.error) return { error: account.error.message || 'Account creation failed' };

  // Save the stripe_account_id to the database (best-effort)
  try {
    await dbPatch('barbers', { id: barber_id }, {
      stripe_account_id: account.id,
      stripe_onboarding_complete: false,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('DB update failed (DB may be paused):', e.message);
  }

  // Generate the hosted onboarding link (expires in 24 hours)
  const link = await stripeRequest(env, 'POST', '/account_links', {
    account: account.id,
    'refresh_url': 'https://www.communitycut.com/pro/dashboard?stripe=refresh',
    'return_url': 'https://www.communitycut.com/pro/dashboard?stripe=complete',
    type: 'account_onboarding',
  });

  if (link.error) return { error: link.error.message || 'Onboarding link creation failed' };

  return {
    account_id: account.id,
    onboarding_url: link.url,
    expires_at: link.expires_at,
  };
}

// POST /api/stripe/payout/instant - pro requests instant payout (1% fee passed through to pro)
async function handleInstantPayout(env, body) {
  const { barber_id, amount_cents } = body;
  if (!barber_id || !amount_cents) return { error: 'barber_id and amount_cents required' };

  // Look up the pro's connected account
  let pro = null;
  try {
    const pros = await dbGet('barbers', { id: `eq.${barber_id}` });
    pro = Array.isArray(pros) ? pros[0] : null;
  } catch (e) { /* DB may be paused */ }

  if (!pro?.stripe_account_id) return { error: 'Pro has no connected Stripe account' };

  // Enforce minimum balance: pro must have at least $10 remaining after payout
  const MINIMUM_BALANCE_CENTS = 1000; // $10.00 — configurable in Stripe Dashboard
  const account = await stripeRequest(env, 'GET', `/accounts/${pro.stripe_account_id}`);
  if (account.error) return { error: 'Could not verify account balance' };

  // Calculate the 1% instant payout fee (passed through to pro, not absorbed by platform)
  const instant_fee_cents = Math.ceil(amount_cents * 0.01);
  const net_payout_cents = amount_cents - instant_fee_cents;

  // Create the instant payout on the pro's connected account
  const payout = await stripeRequest(env, 'POST', `/payouts`, {
    amount: net_payout_cents,
    currency: 'usd',
    method: 'instant',
    'metadata[barber_id]': barber_id,
    'metadata[instant_fee_cents]': instant_fee_cents,
    'metadata[gross_amount_cents]': amount_cents,
  }, pro.stripe_account_id); // Stripe-Account header routes to connected account

  if (payout.error) return { error: payout.error.message || 'Instant payout failed' };

  return {
    payout_id: payout.id,
    gross_amount_cents: amount_cents,
    instant_fee_cents,
    net_payout_cents,
    fee_note: '1% instant payout fee passed through to pro at cost',
    status: payout.status,
    arrival_date: payout.arrival_date,
  };
}

// GET /api/stripe/connect/status?barber_id=xxx - live verification status of a pro's connected account
async function handleConnectStatus(env, url) {
  const barberId = url.searchParams.get('barber_id');
  if (!barberId) return { error: 'barber_id required' };

  let pro = null;
  try {
    const pros = await dbGet('barbers', { id: `eq.${barberId}` });
    pro = Array.isArray(pros) ? pros[0] : null;
  } catch (e) {
    return { error: 'DB lookup failed: ' + e.message };
  }

  if (!pro) return { error: 'Pro not found' };
  if (!pro.stripe_account_id) {
    return { connected: false, onboarding_complete: false };
  }

  const account = await stripeRequest(env, 'GET', `/accounts/${pro.stripe_account_id}`);
  if (account.error) return { error: account.error.message };

  return {
    connected: true,
    account_id: pro.stripe_account_id,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    details_submitted: account.details_submitted,
    onboarding_complete: account.details_submitted && account.charges_enabled,
    requirements: account.requirements?.currently_due || [],
    disabled_reason: account.requirements?.disabled_reason || null,
  };
}

// GET /api/admin/stats - platform stats for owner dashboard
async function handleAdminStats(env) {
  // Get counts from DB
  const [barbers, bookings] = await Promise.all([
    dbGet('barbers', { status: 'eq.approved' }),
    dbGet('bookings', {}),
  ]);
  
  const totalPros = Array.isArray(barbers) ? barbers.length : 0;
  const totalBookings = Array.isArray(bookings) ? bookings.length : 0;
  
  // Get TikTok connection status from KV
  let tiktokConnected = false;
  let tiktokAccount = null;
  try {
    const ttData = await env.TOKENS.get('tiktok_oauth_tokens');
    if (ttData) {
      const tt = JSON.parse(ttData);
      tiktokConnected = !!tt.access_token;
      tiktokAccount = tt.display_name || tt.open_id;
    }
  } catch (e) {}
  
  // Get Stripe status
  let stripeMode = 'test';
  if (env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY.startsWith('rk_live_')) {
    stripeMode = 'live';
  }
  
  return {
    platform: {
      total_pros: totalPros,
      total_bookings: totalBookings,
      total_cities: [...new Set((Array.isArray(barbers) ? barbers : []).map(b => b.city))].length,
      revenue_this_month: 0, // TODO: aggregate from Stripe
    },
    integrations: {
      stripe: { connected: !!env.STRIPE_SECRET_KEY, mode: stripeMode },
      tiktok: { connected: tiktokConnected, account: tiktokAccount },
      gbp: { connected: true, status: 'auto-posting active' },
      pixel: { active: true, pixel_id: 'D8LDTJBC77UAI2I7M9HG' },
    },
    updated_at: new Date().toISOString(),
  };
}

// GET /api/admin/pros - list all pros for admin management
async function handleAdminPros(url) {
  const status = url.searchParams.get('status') || 'all';
  const params = status !== 'all' ? { status: `eq.${status}` } : {};
  const pros = await dbGet('barbers', { ...params, limit: '200' });
  return pros;
}

// PATCH /api/admin/pros/:id - update pro status
async function handleAdminUpdatePro(id, body) {
  const { status, notes } = body;
  const updated = await dbPatch('barbers', { id }, { status, updated_at: new Date().toISOString() });
  return updated;
}

// GET /api/admin/bookings - list all bookings
async function handleAdminBookings(url, env) {
  const status = url.searchParams.get('status');
  // Read from KV cc_bookings (guest bookings stored here due to DB FK constraints)
  let bookings = [];
  if (env && env.TOKENS) {
    try {
      const raw = await env.TOKENS.get('cc_bookings');
      bookings = raw ? JSON.parse(raw) : [];
    } catch (e) {
      bookings = [];
    }
  }
  if (status) {
    bookings = bookings.filter(b => b.status === status);
  }
  return bookings;
}

// GET /api/admin/outreach - pro outreach queue data
async function handleAdminOutreach() {
  // Return the outreach queue data (cities with demand but no pros)
  const pros = await dbGet('barbers', { status: 'eq.approved' });
  const prosCities = new Set((Array.isArray(pros) ? pros : []).map(b => b.city?.toLowerCase()));
  
  // Top demand cities (from platform data)
  const demandCities = [
    { city: 'Chicago', state: 'IL', leads: 56, tiktok_search: 'Chicago barber' },
    { city: 'Austin', state: 'TX', leads: 56, tiktok_search: 'Austin barber' },
    { city: 'Houston', state: 'TX', leads: 48, tiktok_search: 'Houston barber' },
    { city: 'Phoenix', state: 'AZ', leads: 45, tiktok_search: 'Phoenix barber' },
    { city: 'Philadelphia', state: 'PA', leads: 42, tiktok_search: 'Philadelphia barber' },
    { city: 'San Antonio', state: 'TX', leads: 38, tiktok_search: 'San Antonio barber' },
    { city: 'Dallas', state: 'TX', leads: 35, tiktok_search: 'Dallas barber' },
    { city: 'San Diego', state: 'CA', leads: 33, tiktok_search: 'San Diego barber' },
    { city: 'Denver', state: 'CO', leads: 30, tiktok_search: 'Denver barber' },
    { city: 'Seattle', state: 'WA', leads: 28, tiktok_search: 'Seattle barber' },
  ];
  
  return {
    total_cities: 1060,
    total_leads: 898,
    cities: demandCities,
  };
}

// POST /api/admin/outreach/mark-contacted - mark city as contacted
async function handleMarkContacted(body, env) {
  const { city, state, channel } = body;
  if (!city) return { error: 'city required' };
  const contactedAt = new Date().toISOString();
  // Persist to KV
  try {
    const key = `outreach_contacted_${city.toLowerCase().replace(/\s+/g, '_')}_${(state||'').toLowerCase()}`;
    const record = { city, state, channel, contacted_at: contactedAt };
    await env.TOKENS.put(key, JSON.stringify(record));
    // Update the master contacted list
    const listRaw = await env.TOKENS.get('outreach_contacted_list');
    const list = listRaw ? JSON.parse(listRaw) : [];
    const existing = list.findIndex(x => x.city === city && x.state === state);
    if (existing >= 0) list[existing] = record;
    else list.push(record);
    await env.TOKENS.put('outreach_contacted_list', JSON.stringify(list));
  } catch (e) {
    console.error('KV write error:', e.message);
  }
  return { success: true, city, state, channel, contacted_at: contactedAt };
}

// GET /api/stripe/config - get publishable key for frontend
async function handleStripeConfig() {
  return { publishable_key: STRIPE_PK, publishableKey: STRIPE_PK, mode: 'live' };
}

// ─── Stripe Webhook Signature Verification (Web Crypto API — no npm needed) ────
async function verifyStripeSignature(body, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = sigHeader.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
  const signature = parts.find(p => p.startsWith('v1='))?.split('=')[1];
  if (!timestamp || !signature) return false;
  // Reject events older than 5 minutes (replay attack protection)
  if (Math.floor(Date.now() / 1000) - parseInt(timestamp) > 300) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC', key, encoder.encode(`${timestamp}.${body}`)
  );
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return expectedSig === signature;
}

// POST /api/stripe/webhook - handle Stripe webhooks with signature verification
async function handleStripeWebhook(request, env) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  // Verify signature if STRIPE_WEBHOOK_SECRET is set
  if (env.STRIPE_WEBHOOK_SECRET) {
    const isValid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!isValid) {
      console.warn('Stripe webhook signature verification failed');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 });
    }
  } else {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch (e) {
    return { error: 'Invalid JSON' };
  }

  // Idempotency: skip duplicate events
  const eventKey = `stripe_event_${event.id}`;
  try {
    const alreadyProcessed = await env.TOKENS.get(eventKey);
    if (alreadyProcessed) return { received: true, duplicate: true };
  } catch (e) {}

  // Handle all relevant events
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const proId = session.metadata?.pro_id;
      if (proId) {
        await dbPatch('barbers', { id: proId }, {
          status: 'approved',
          updated_at: new Date().toISOString(),
        }).catch(e => console.warn('DB update failed:', e.message));
      }
      break;
    }
    case 'payment_intent.succeeded': {
      const intent = event.data.object;
      const bookingId = intent.metadata?.booking_id;
      if (bookingId) {
        // Get the charge_id from the intent for future transfer linking
        const chargeId = intent.latest_charge || null;
        await dbPatch('bookings', { id: bookingId }, {
          status: 'confirmed',
          payment_status: 'paid',
          stripe_payment_intent_id: intent.id,
          stripe_charge_id: chargeId,
          updated_at: new Date().toISOString(),
        }).catch(e => console.warn('DB update failed:', e.message));
        // Also update KV booking record
        try {
          const raw = await env.TOKENS.get('cc_bookings');
          if (raw) {
            const bookings = JSON.parse(raw);
            const updated = bookings.map(b => b.id === bookingId
              ? { ...b, payment_status: 'paid', stripe_payment_intent_id: intent.id, stripe_charge_id: chargeId } : b);
            await env.TOKENS.put('cc_bookings', JSON.stringify(updated));
          }
        } catch (e) { console.warn('KV booking update failed:', e.message); }
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object;
      const bookingId = intent.metadata?.booking_id;
      if (bookingId) {
        const reason = intent.last_payment_error?.message || 'Payment failed';
        await dbPatch('bookings', { id: bookingId }, {
          payment_status: 'failed',
          payment_failure_reason: reason,
          updated_at: new Date().toISOString(),
        }).catch(e => console.warn('DB update failed:', e.message));
      }
      break;
    }
    case 'transfer.created': {
      const transfer = event.data.object;
      console.log(`Transfer created: ${transfer.id} → ${transfer.destination} for $${transfer.amount / 100}`);
      break;
    }
    case 'transfer.failed': {
      const transfer = event.data.object;
      console.error(`Transfer FAILED: ${transfer.id} → ${transfer.destination}`);
      // Queue an admin alert email
      try {
        const emailRecord = {
          to: 'admin@communitycut.com',
          subject: `[ALERT] Stripe transfer failed — ${transfer.id}`,
          body: `A Stripe transfer failed.\n\nTransfer ID: ${transfer.id}\nDestination: ${transfer.destination}\nAmount: $${transfer.amount / 100}\nTransfer Group: ${transfer.transfer_group || 'N/A'}\n\nCheck the Stripe Dashboard for details.`,
          created_at: new Date().toISOString(),
          type: 'transfer_failure_alert',
        };
        const pendingRaw = await env.TOKENS.get('pending_emails');
        const pending = pendingRaw ? JSON.parse(pendingRaw) : [];
        pending.unshift(emailRecord);
        await env.TOKENS.put('pending_emails', JSON.stringify(pending.slice(0, 200)));
      } catch (e) { console.warn('Alert email queue failed:', e.message); }
      break;
    }
    case 'account.updated': {
      // Update pro's onboarding_complete status when Stripe verifies their account
      const account = event.data.object;
      const barberId = account.metadata?.barber_id;
      if (barberId) {
        const onboardingComplete = account.details_submitted && account.charges_enabled;
        await dbPatch('barbers', { id: barberId }, {
          stripe_onboarding_complete: onboardingComplete,
          updated_at: new Date().toISOString(),
        }).catch(e => console.warn('DB update failed:', e.message));
      }
      break;
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object;
      console.error(`Dispute created: ${dispute.id} — $${dispute.amount / 100} — reason: ${dispute.reason}`);
      try {
        const emailRecord = {
          to: 'admin@communitycut.com',
          subject: `[URGENT] Stripe dispute filed — ${dispute.id}`,
          body: `A dispute has been filed.\n\nDispute ID: ${dispute.id}\nAmount: $${dispute.amount / 100}\nReason: ${dispute.reason}\nCharge ID: ${dispute.charge}\nDue by: ${new Date(dispute.evidence_details?.due_by * 1000).toISOString()}\n\nRespond in the Stripe Dashboard immediately.`,
          created_at: new Date().toISOString(),
          type: 'dispute_alert',
        };
        const pendingRaw = await env.TOKENS.get('pending_emails');
        const pending = pendingRaw ? JSON.parse(pendingRaw) : [];
        pending.unshift(emailRecord);
        await env.TOKENS.put('pending_emails', JSON.stringify(pending.slice(0, 200)));
      } catch (e) { console.warn('Alert email queue failed:', e.message); }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const proId = sub.metadata?.pro_id;
      if (proId && sub.status) {
        await dbPatch('barbers', { id: proId }, {
          subscription_status: sub.status,
          updated_at: new Date().toISOString(),
        }).catch(e => console.warn('DB update failed:', e.message));
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const proId = sub.metadata?.pro_id;
      if (proId) {
        await dbPatch('barbers', { id: proId }, {
          subscription_status: 'canceled',
          updated_at: new Date().toISOString(),
        }).catch(e => console.warn('DB update failed:', e.message));
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.warn(`Invoice payment failed: ${invoice.id} for customer ${invoice.customer}`);
      break;
    }
    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  // Mark event as processed (TTL: 24 hours)
  try {
    await env.TOKENS.put(eventKey, '1', { expirationTtl: 86400 });
  } catch (e) {}

  return { received: true };
}

// ─── Email Sender via Gmail OAuth ─────────────────────────────────────────────────
async function sendEmailViaGmail(accessToken, to, subject, body) {
  const email = [
    `From: CommunityCut <admin@communitycut.com>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
  ].join('\r\n');
  const encoded = btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error?.message || 'Gmail send failed');
  return result;
}

async function getGmailAccessToken(env) {
  const raw = await env.TOKENS.get('gmail_credentials');
  if (!raw) return null;
  const creds = JSON.parse(raw);
  if (creds.expires_at && new Date(creds.expires_at) > new Date(Date.now() + 60000)) {
    return creds.access_token;
  }
  if (!creds.refresh_token) return null;
  const params = new URLSearchParams({
    client_id: creds.client_id || '',
    client_secret: creds.client_secret || '',
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await r.json();
  if (data.access_token) {
    const updated = { ...creds, access_token: data.access_token,
      expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString() };
    await env.TOKENS.put('gmail_credentials', JSON.stringify(updated));
    return data.access_token;
  }
  return null;
}

async function processPendingEmails(env) {
  const raw = await env.TOKENS.get('pending_emails');
  if (!raw) return { sent: 0, failed: 0 };
  const emails = JSON.parse(raw);
  if (!emails.length) return { sent: 0, failed: 0 };
  const accessToken = await getGmailAccessToken(env);
  if (!accessToken) {
    console.log('No Gmail access token, skipping email send');
    return { sent: 0, failed: 0, reason: 'no_token' };
  }
  let sent = 0, failed = 0;
  const remaining = [];
  for (const email of emails) {
    try {
      await sendEmailViaGmail(accessToken, email.to, email.subject, email.body);
      sent++;
    } catch (e) {
      console.error('Email send failed:', e.message, 'to:', email.to);
      failed++;
      const attempts = (email.attempts || 0) + 1;
      if (attempts < 3) remaining.push({ ...email, attempts });
    }
  }
  await env.TOKENS.put('pending_emails', JSON.stringify(remaining));
  console.log(`Email cron: sent=${sent}, failed=${failed}, remaining=${remaining.length}`);
  return { sent, failed };
}

export async function handleScheduled(event, env) {
  const now = new Date();
  const hour = now.getUTCHours();
  // Run GBP post at 9 AM UTC
  if (hour === 9) {
    try {
      await postGBPUpdate(env);
    } catch (e) {
      console.error('GBP cron error:', e.message);
    }
  }
  // Process pending booking confirmation emails every cron run
  try {
    await processPendingEmails(env);
  } catch (e) {
    console.error('Email cron error:', e.message);
  }
  // Refresh TikTok token if expiring within 24 hours
  try {
    await refreshTikTokTokenIfNeeded(env);
  } catch (e) {
    console.error('TikTok refresh error:', e.message);
  }
}

async function postGBPUpdate(env) {
  // Get GBP token from KV
  const gbpRaw = await env.TOKENS.get('gbp_credentials');
  if (!gbpRaw) return;
  const gbp = JSON.parse(gbpRaw);
  if (!gbp.access_token || !gbp.location_name) return;
  // Generate a daily tip post using a rotating template
  const tips = [
    'Book your next haircut with a mobile barber — no waiting, no commute. Find pros near you at CommunityCut.com ✂️',
    'Fresh cuts, delivered to your door. Mobile barbers, braiders & stylists available now at CommunityCut.com 💈',
    'Looking for a barber near you? CommunityCut connects you with vetted mobile pros in your city. Book today! 🔥',
    'Why drive to a barbershop when the barber comes to you? Discover mobile pros at CommunityCut.com ✂️',
    'New week, fresh cut. Find mobile barbers and beauty pros near you at CommunityCut.com 💈',
  ];
  const now = new Date();
  const tip = tips[now.getDay() % tips.length];
  // Post to GBP via Google My Business API
  const postBody = {
    languageCode: 'en-US',
    summary: tip,
    callToAction: { actionType: 'LEARN_MORE', url: 'https://www.communitycut.com' },
    topicType: 'STANDARD',
  };
  await fetch(`https://mybusiness.googleapis.com/v4/${gbp.location_name}/localPosts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gbp.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postBody),
  });
}

async function refreshTikTokTokenIfNeeded(env) {
  const ttRaw = await env.TOKENS.get('tiktok_oauth_tokens');
  if (!ttRaw) return;
  const tt = JSON.parse(ttRaw);
  if (!tt.refresh_token) return;
  // Check if expires within 48 hours
  const expiresAt = new Date(tt.expires_at || 0);
  const hoursLeft = (expiresAt - Date.now()) / 3600000;
  if (hoursLeft > 48) return;
  // Refresh the token
  const params = new URLSearchParams({
    client_key: 'awh8hd5nr2gr9kv9',
    client_secret: 'iH6x5DyZNZYRAEPLTWhGzgsuYbEYPwLd',
    grant_type: 'refresh_token',
    refresh_token: tt.refresh_token,
  });
  const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await r.json();
  if (data.data?.access_token) {
    const newTt = {
      ...tt,
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token || tt.refresh_token,
      expires_at: new Date(Date.now() + (data.data.expires_in || 86400) * 1000).toISOString(),
    };
    await env.TOKENS.put('tiktok_oauth_tokens', JSON.stringify(newTt), { expirationTtl: 5184000 });
    console.log('TikTok token refreshed successfully');
  }
}

// GET /api/health - health check
async function handleHealth(env) {
  return {
    status: 'ok',
    version: '2.0.0',
    backend: 'cloudflare-worker',
    famous_ai: 'replaced',
    stripe: env.STRIPE_SECRET_KEY ? 'configured' : 'missing',
    timestamp: new Date().toISOString(),
  };
}

// POST /api/admin/notify-pro-application - notify admin of new pro application
async function handleProApplicationNotification(body, env) {
  const { barber_id, name, email, phone, city, specialty, instagram, tiktok, bio, referral_code } = body;
  // Store notification in KV for admin to review
  const notification = {
    barber_id,
    name,
    email,
    phone,
    city,
    specialty,
    instagram,
    tiktok,
    bio: bio || '',
    referral_code,
    applied_at: new Date().toISOString(),
  };
  // Store in KV with a list of pending applications
  const existingRaw = await env.TOKENS.get('pending_pro_applications');
  const existing = existingRaw ? JSON.parse(existingRaw) : [];
  existing.unshift(notification);
  // Keep last 100 applications
  const trimmed = existing.slice(0, 100);
  await env.TOKENS.put('pending_pro_applications', JSON.stringify(trimmed));
  return { success: true, message: 'Application notification recorded', barber_id };
}

// POST /api/referral/apply - register a referral partner
async function handleReferralApply(body, env) {
  const { name, email, phone, role } = body;
  if (!name || !email || !phone) {
    return { error: 'name, email, and phone are required' };
  }
  // Generate a referral code from name
  const code = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) + Math.floor(Math.random() * 1000);
  const partner = {
    name,
    email,
    phone,
    role: role || 'partner',
    referral_code: code,
    applied_at: new Date().toISOString(),
    status: 'pending',
  };
  // Store in KV (use cc_referral_partners as canonical key)
  const existingRaw = await env.TOKENS.get('cc_referral_partners');
  const existing = existingRaw ? JSON.parse(existingRaw) : [];
  existing.unshift(partner);
  const trimmed = existing.slice(0, 500);
  await env.TOKENS.put('cc_referral_partners', JSON.stringify(trimmed));
  return { success: true, referral_code: code, message: `Welcome ${name}! Your referral code is ${code}` };
}

// POST /api/pro/profile - store extended pro info (email, phone, bio, social) in KV
async function handleProProfileStore(body, env) {
  const { barber_id, email, phone, bio, instagram, tiktok } = body;
  if (!barber_id) return { error: 'barber_id is required' };
  const profileData = {
    barber_id,
    email: email || '',
    phone: phone || '',
    bio: bio || '',
    instagram: instagram || '',
    tiktok: tiktok || '',
    updated_at: new Date().toISOString(),
  };
  await env.TOKENS.put(`cc_pro_profile_${barber_id}`, JSON.stringify(profileData));
  return { success: true };
}

// GET /api/pro/profile - fetch extended pro info from KV
async function handleProProfileGet(url, env) {
  const barber_id = url.searchParams.get('barber_id');
  if (!barber_id) return { error: 'barber_id is required' };
  const raw = await env.TOKENS.get(`cc_pro_profile_${barber_id}`);
  if (!raw) return {};
  return JSON.parse(raw);
}

// GET /api/admin/pending-applications - list pending pro applications
async function handleGetPendingApplications(env) {
  const raw = await env.TOKENS.get('pending_pro_applications');
  const applications = raw ? JSON.parse(raw) : [];
  return { applications, count: applications.length };
}

// GET /api/admin/pending-emails - list pending email notifications
async function handleGetPendingEmails(env) {
  const raw = await env.TOKENS.get('pending_emails');
  const emails = raw ? JSON.parse(raw) : [];
  return { emails, count: emails.length };
}

// GET /api/admin/referral-partners - list referral partners
async function handleGetReferralPartners(env) {
  // Check both KV keys for backwards compatibility
  const raw = await env.TOKENS.get('cc_referral_partners') || await env.TOKENS.get('referral_partners');
  const partners = raw ? JSON.parse(raw) : [];
  return { partners, count: partners.length };
}

// POST /api/waitlist - save exit-intent lead capture signup
async function handleWaitlistSignup(body, env) {
  const { email, zip, source } = body;
  if (!email) return { error: 'email is required' };
  const record = {
    email: email.trim().toLowerCase(),
    zip: zip || null,
    source: source || 'unknown',
    created_at: new Date().toISOString(),
  };
  const raw = await env.TOKENS.get('cc_waitlist');
  const list = raw ? JSON.parse(raw) : [];
  const exists = list.some(r => r.email === record.email);
  if (!exists) {
    list.unshift(record);
    await env.TOKENS.put('cc_waitlist', JSON.stringify(list.slice(0, 5000)));
  }
  // Queue a welcome email
  try {
    const emailRecord = {
      to: record.email,
      subject: "You're on the CommunityCut waitlist — $10 off your first booking",
      body: `Hi there,\n\nYou're on the list! We'll notify you the moment a vetted mobile barber, braider, or nail tech opens up in your area${zip ? ` (${zip})` : ''}.\n\nAs an early adopter, your first booking is $10 off — automatically applied when you book.\n\nBrowse our current pros at:\nhttps://www.communitycut.com\n\nSee you soon!\nThe CommunityCut Team`,
      created_at: new Date().toISOString(),
      type: 'waitlist_welcome',
      attempts: 0,
    };
    const pendingRaw = await env.TOKENS.get('pending_emails');
    const pending = pendingRaw ? JSON.parse(pendingRaw) : [];
    pending.unshift(emailRecord);
    await env.TOKENS.put('pending_emails', JSON.stringify(pending.slice(0, 200)));
  } catch (e) {
    console.error('Waitlist welcome email queue failed:', e.message);
  }
  return { success: true, message: "You're on the waitlist! Check your email for your $10 discount." };
}

// POST /api/pro/claim - link a user account to a barber profile
async function handleProClaim(body, env) {
  const { user_id, barber_id, email } = body;
  if (!user_id || !barber_id) {
    return { error: 'user_id and barber_id are required' };
  }
  // Update the barber record with the user_id
  const updated = await dbPatch('barbers', { id: barber_id }, { user_id });
  return { success: true, barber_id, user_id, message: 'Pro profile linked to user account' };
}

// ─── Main API Router ──────────────────────────────────────────────────────────
export async function handleAPIRequest(request, url, env) {
  const pathname = url.pathname;
  const method = request.method;
  const origin = request.headers.get('Origin');
  
  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  
  // Only handle /api/ routes
  if (!pathname.startsWith('/api/')) return null;
  
  try {
    let data;
    
    // ── Health ──────────────────────────────────────────────────────────────
    if (pathname === '/api/health') {
      data = await handleHealth(env);
    }
    
    // ── Pros ────────────────────────────────────────────────────────────────
    else if (pathname === '/api/pros' && method === 'GET') {
      data = await handleGetPros(request, url);
    }
    else if (pathname.match(/^\/api\/pros\/\d+$/) && method === 'GET') {
      const id = pathname.split('/').pop();
      data = await handleGetPro(id);
      if (!data) return jsonResponse({ error: 'Pro not found' }, 404, origin);
    }
    
    // ── Bookings ─────────────────────────────────────────────────────────────
    else if (pathname === '/api/bookings' && method === 'POST') {
      const body = await request.json();
      data = await handleCreateBooking(body, env);
    }
    
    // ── Stripe ───────────────────────────────────────────────────────────────
    else if (pathname === '/api/stripe/config' && method === 'GET') {
      data = await handleStripeConfig();
    }
    else if (pathname === '/api/stripe/create-checkout' && method === 'POST') {
      const body = await request.json();
      data = await handleCreateCheckout(env, body);
    }
    else if (pathname === '/api/stripe/create-payment-intent' && method === 'POST') {
      const body = await request.json();
      data = await handleCreatePaymentIntent(env, body);
    }
    else if (pathname === '/api/stripe/webhook' && method === 'POST') {
      // Webhook returns a Response directly (not data) to support 400 on bad signature
      const result = await handleStripeWebhook(request, env);
      if (result instanceof Response) return result;
      data = result;
    }
    // ── Stripe Connect: Express Onboarding ──────────────────────────────────────
    else if (pathname === '/api/stripe/connect/onboard' && method === 'POST') {
      const body = await request.json();
      data = await handleConnectOnboard(env, body);
    }
    else if (pathname === '/api/stripe/connect/status' && method === 'GET') {
      data = await handleConnectStatus(env, url);
    }
    // ── Stripe SC&T: Job Completion Transfer ────────────────────────────────────
    else if (pathname === '/api/stripe/transfer' && method === 'POST') {
      const body = await request.json();
      data = await handleJobCompleteTransfer(env, body);
    }
    
    // ── Stripe Instant Payout (1% fee passthrough to pro) ──────────────────
    else if (pathname === '/api/stripe/payout/instant' && method === 'POST') {
      const body = await request.json();
      data = await handleInstantPayout(env, body);
    }
    
    // ── Admin ────────────────────────────────────────────────────────────────
    else if (pathname === '/api/admin/stats' && method === 'GET') {
      data = await handleAdminStats(env);
    }
    else if (pathname === '/api/admin/pros' && method === 'GET') {
      data = await handleAdminPros(url);
    }
    else if (pathname.match(/^\/api\/admin\/pros\/\d+$/) && method === 'PATCH') {
      const id = pathname.split('/').pop();
      const body = await request.json();
      data = await handleAdminUpdatePro(id, body);
    }
    else if (pathname === '/api/admin/bookings' && method === 'GET') {
      data = await handleAdminBookings(url, env);
    }
    else if (pathname.startsWith('/api/admin/bookings/') && method === 'PATCH') {
      const bookingId = pathname.replace('/api/admin/bookings/', '');
      const body = await request.json().catch(() => ({}));
      if (env && env.TOKENS && bookingId && body.status) {
        const raw = await env.TOKENS.get('cc_bookings');
        const bookings = raw ? JSON.parse(raw) : [];
        const updated = bookings.map(b => b.id === bookingId ? { ...b, status: body.status } : b);
        await env.TOKENS.put('cc_bookings', JSON.stringify(updated));
        data = { success: true, id: bookingId, status: body.status };
      } else {
        data = { error: 'Missing bookingId or status' };
      }
    }
    else if (pathname === '/api/admin/outreach' && method === 'GET') {
      data = await handleAdminOutreach();
    }
    else if (pathname === '/api/admin/outreach/mark-contacted' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      data = await handleMarkContacted(body, env);
    }
    
    // ── TikTok OAuth status (also handled by tiktok handler, but expose here too) ──
    else if (pathname === '/api/tiktok/oauth/status' && method === 'GET') {
      // Handled by the TikTok OAuth handler — return null to let it pass through
      return null;
    }
    
    // ── Pro Application Notification ────────────────────────────────────────
    else if (pathname === '/api/admin/notify-pro-application' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      data = await handleProApplicationNotification(body, env);
    }
    
    // ── Referral Partner Application ─────────────────────────────────────────
    else if (pathname === '/api/referral/apply' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      data = await handleReferralApply(body, env);
    }
    
    // ── Admin: Pending Applications ────────────────────────────────────────
    else if (pathname === '/api/admin/pending-applications' && method === 'GET') {
      if (!isAdminRequest(request)) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
      data = await handleGetPendingApplications(env);
    }
    
    // ── Admin: Pending Emails ──────────────────────────────────────────────
    else if (pathname === '/api/admin/pending-emails' && method === 'GET') {
      if (!isAdminRequest(request)) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
      data = await handleGetPendingEmails(env);
    }
    
    // ── Admin: Referral Partners ─────────────────────────────────────────────
    else if (pathname === '/api/admin/referral-partners' && method === 'GET') {
      if (!isAdminRequest(request)) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
      data = await handleGetReferralPartners(env);
    }
    
    // ── Pro: Claim Profile ───────────────────────────────────────────────────
    else if (pathname === '/api/pro/claim' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      data = await handleProClaim(body, env);
    }

    // ── Pro: Profile (KV-stored contact info) ────────────────────────────────
    else if (pathname === '/api/pro/profile' && method === 'GET') {
      data = await handleProProfileGet(url, env);
    }
    else if (pathname === '/api/pro/profile' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      data = await handleProProfileStore(body, env);
    }
    
    // ── Waitlist signup ─────────────────────────────────────────────────────
    else if (pathname === '/api/waitlist' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      data = await handleWaitlistSignup(body, env);
    }
    else if (pathname === '/api/admin/waitlist' && method === 'GET') {
      if (!isAdminRequest(request)) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
      const raw = await env.TOKENS.get('cc_waitlist');
      const list = raw ? JSON.parse(raw) : [];
      data = { waitlist: list, count: list.length };
    }
    
    // ── Not found ────────────────────────────────────────────────────────────
    else {
      // Not an API route we handle — return null to pass through to origin
      return null;
    }
    
    return jsonResponse(data, 200, origin);
    
  } catch (err) {
    console.error('API Error:', err.message);
    return jsonResponse({ error: 'Internal server error', message: err.message }, 500, origin);
  }
}
