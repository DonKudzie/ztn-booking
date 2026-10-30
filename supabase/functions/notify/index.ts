// ZTN Studio Booking - email notifications (Supabase Edge Function).
// Called by the bookings_notify trigger through pg_net, authenticated with a
// shared secret header. Sends mail through Resend.
//
// Secrets (Dashboard -> Edge Functions -> Secrets):
//   RESEND_API_KEY   Resend API key
//   FROM_EMAIL       e.g. "ZTN Studio <studio@yourdomain.co.zw>" (verified in Resend)
//   ENGINEER_EMAIL   address that receives new requests
//   NOTIFY_SECRET    same value as the ztn_notify_secret Vault secret
//   SITE_URL         optional, e.g. https://you.github.io/ztn-booking (adds links)

type Booking = {
  ref: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  setup_time: string | null;
  studio: string;
  title: string;
  requester_name: string;
  department: string | null;
  requester_email: string;
  contact_number: string | null;
  producer: string | null;
  live_recorded: string | null;
  crew: string | null;
  priority: string | null;
  status: string;
  notes: string;
};

type Payload = { type: "INSERT" | "UPDATE"; old_status: string | null; record: Booking };

const env = (k: string) => Deno.env.get(k) ?? "";
const DASH = "—";

const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function summary(b: Booking): string {
  const lines = [
    ["Reference", b.ref],
    ["Date / time", `${longDate(b.booking_date)}, ${hm(b.start_time)} - ${hm(b.end_time)}`],
    ["Setup access", hm(b.setup_time)],
    ["Studio", b.studio],
    ["Programme", b.title],
    ["Requester", [b.requester_name, b.department, b.requester_email, b.contact_number].filter(Boolean).join(` ${DASH} `)],
    ["Producer", b.producer ?? ""],
    ["Live/Rec", b.live_recorded ?? ""],
    ["Crew", b.crew ?? ""],
    ["Priority", b.priority ?? ""],
    ["Status", b.status],
    ["Notes", b.notes],
  ];
  return lines.filter(([, v]) => v).map(([k, v]) => `${(k + ":").padEnd(14)}${v}`).join("\n");
}

function buildMessage(p: Payload): { to: string; subject: string; text: string } | null {
  const b = p.record;
  const tag = `${DASH} ${b.ref} ${DASH} ${b.title}`;
  const site = env("SITE_URL").replace(/\/$/, "");
  const sign = "\n\nZTN Studio / Technical Department";

  if (p.type === "INSERT") {
    const to = env("ENGINEER_EMAIL");
    if (!to) return null;
    const conflict = b.status === "Conflict";
    const show = /Overlaps regular show/.test(b.notes)
      ? "NOTE: this time overlaps a regular weekly show. Approve or decline at your discretion.\n\n"
      : "";
    return {
      to,
      subject: conflict ? `[ZTN Studio] CONFLICT ${tag}` : `[ZTN Studio] New booking request ${tag}`,
      text: (conflict
        ? "A new booking request CLASHES with an existing booking.\n\n"
        : "A new studio booking request has been submitted.\n\n") + show +
        summary(b) + (site ? `\n\nReview: ${site}/engineer.html` : ""),
    };
  }

  if (p.old_status === b.status) return null;
  const to = b.requester_email;
  switch (b.status) {
    case "Confirmed":
      return {
        to,
        subject: `[ZTN Studio] Booking confirmed ${tag}`,
        text: "Your studio booking has been CONFIRMED.\n\n" + summary(b) + sign,
      };
    case "Declined":
    case "Cancelled":
      return {
        to,
        subject: `[ZTN Studio] Booking ${b.status.toLowerCase()} ${tag}`,
        text: `Your studio booking has been ${b.status.toUpperCase()}.\n\nReason / notes:\n${b.notes || "(none given)"}\n\n` +
          summary(b) + sign,
      };
    case "Rescheduled":
      return {
        to,
        subject: `[ZTN Studio] Booking rescheduled ${tag}`,
        text: "Your studio booking has been rescheduled. Current details:\n\n" + summary(b) + sign,
      };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = env("NOTIFY_SECRET");
  if (!secret || req.headers.get("x-ztn-secret") !== secret) return new Response("Forbidden", { status: 403 });

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const msg = buildMessage(payload);
  if (!msg || !msg.to) return new Response("skipped", { status: 200 });
  if (!env("RESEND_API_KEY")) return new Response("RESEND_API_KEY not set", { status: 200 });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env("FROM_EMAIL") || "ZTN Studio <onboarding@resend.dev>",
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
    }),
  });
  return new Response(await res.text(), { status: res.ok ? 200 : 502 });
});
