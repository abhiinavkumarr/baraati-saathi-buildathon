// Generates a realistic printed wedding card WITH text (Nano Banana), to test
// Act 1's "I have a card" path. Usage: node --env-file=.env --import tsx scripts/make-test-card.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, apiVersion: 'v1beta' });
const prompt = `A photograph of a printed Indian wedding invitation card lying on a wooden table.
Elegant maroon and gold design. The card text, clearly printed in English:
"Shri Ganeshaya Namah
Mr. & Mrs. Rakesh Agarwal
request the pleasure of your company at the wedding of their daughter
Ananya
with
Vikram
son of Mr. & Mrs. Sunil Jain
Mehendi — Friday, 5 March 2027, 4 PM — Agarwal Residence, Civil Lines, Jaipur
Sangeet — Saturday, 6 March 2027, 7:30 PM — Rambagh Palace, Jaipur
Wedding — Sunday, 7 March 2027, 8 PM onwards — Rambagh Palace, Jaipur
RSVP: Rohan Agarwal"`;

const r = (await ai.interactions.create({
  model: 'gemini-nano-banana-2.1',
  input: prompt,
  response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '3:4' },
} as never)) as { output_image?: { data?: string } };
mkdirSync('.data/probe', { recursive: true });
writeFileSync('.data/probe/test-card.jpg', Buffer.from(r.output_image!.data!, 'base64'));
console.log('saved .data/probe/test-card.jpg');
