import {createManager} from "../chat-manager.mjs";
import {managedEnabled, ticketOrigin, validSlug} from "../widget-access.mjs";

export const config = {
  path: "/api/chat-booking-click",
  rateLimit: {windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"]}
};

const result = status => new Response(null, {status, headers:{"Cache-Control":"no-store"}});
const eventId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function recordBookingClick(request) {
  if (request.method !== "POST") return result(405);
  if (request.headers.get("Origin") !== new URL(request.url).origin) return result(403);
  if (!managedEnabled(true)) return result(503);

  let payload;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > 512) return result(413);
      chunks.push(chunk);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return result(400);
  }

  const {bot, language, id} = payload ?? {};
  if (!validSlug(bot) || !["en", "es"].includes(language) ||
      typeof id !== "string" || !eventId.test(id)) return result(400);
  const origin = ticketOrigin(request.headers.get("X-Chat-Widget-Ticket"),
    bot, language, process.env.SUPABASE_SECRET_KEY?.trim());
  if (!origin) return result(403);

  try {
    await createManager().bookingClick({bot, origin, language, id});
    return result(204);
  } catch {
    console.error("Booking click could not be recorded");
    return result(503);
  }
}
