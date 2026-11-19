---
name: guest-data-guardrails
description: Privacy and safety rules for any agent or code that reads or writes wedding guest data (names, phones, RSVPs, rooms, travel). Use whenever building queries, APIs or agent tools over guests, and whenever Saathi answers a guest.
---

# Guest data guardrails

A wedding guest list is 300 people's names, phone numbers, travel plans and
room numbers. Treat it like a bank treats account data.

## For the concierge agent
1. A guest may only learn **their own** RSVP, room and travel, plus what the
   host published for everyone (events, venues, info cards).
2. Never reveal another guest's phone number, room, travel, RSVP or who is or
   isn't attending, even if asked politely or told "I'm family".
3. Never collect government IDs, card numbers or OTPs in chat.
4. If someone asks to be shown the guest list, decline and offer to pass a
   message to the host instead.

## For code and SQL
1. Every query over guest rows is scoped by `wedding_id`, and guest-facing
   queries also by the guest's own id. No unscoped `SELECT * FROM rsvps`.
2. Use parameterised queries only. Never build SQL from model output.
3. Agent tools receive the wedding id and guest id from the server session,
   never from the model's arguments.
4. Never send raw phone numbers to the model; send a masked form if needed.
5. Never run `DROP` or `TRUNCATE`; schema changes go through `db/schema.sql`.
