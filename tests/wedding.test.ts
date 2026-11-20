import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSlug, makeToken, missingFields, normalizeDraft } from '../server/wedding.ts';
import { getSkill, loadSkills, skillMenu } from '../server/skills.ts';
import { cell } from '../server/insights.ts';

test('normalizeDraft cleans model output', () => {
  const d = normalizeDraft({
    partner1_name: '  Riya ',
    partner2_name: 42,
    events: [
      { name: 'Sangeet', date: '12 Feb', start_time: '7:30pm', venue_name: 'Lake Palace' },
      { name: 'Pheras', date: '2027-02-13', start_time: '20:00' },
      { date: '2027-02-14' }, // no name: dropped
    ],
    info: [{ question: 'Parking?', answer: '' }, { question: 'Gifts?', answer: 'Your blessings' }],
  });
  assert.equal(d.partner1_name, 'Riya');
  assert.equal(d.partner2_name, '');
  assert.deepEqual(d.events.map((e) => [e.name, e.date, e.start_time]), [
    ['Sangeet', '', ''], // invalid formats become "unknown", never guessed
    ['Pheras', '2027-02-13', '20:00'],
  ]);
  assert.deepEqual(d.info, [{ question: 'Gifts?', answer: 'Your blessings' }]);
});

test('normalizeDraft survives garbage', () => {
  for (const junk of [null, undefined, 'x', 7, [], { events: 'no' }]) {
    const d = normalizeDraft(junk);
    assert.deepEqual(d.events, []);
    assert.equal(d.partner1_name, '');
  }
});

test('a draft is ready only with names, a dated venue and a style', () => {
  const base = normalizeDraft({ partner1_name: 'Riya', partner2_name: 'Kabir' });
  assert.deepEqual(missingFields(base), ['ceremony_with_date_and_venue', 'style']);
  const ready = normalizeDraft({
    partner1_name: 'Riya', partner2_name: 'Kabir', style: 'royal-rajasthani',
    events: [{ name: 'Pheras', date: '2027-02-13', venue_name: 'Lake Palace' }],
  });
  assert.deepEqual(missingFields(ready), []);
});

test('slugs are readable and unguessable; tokens are long', () => {
  const slug = makeSlug(normalizeDraft({ partner1_name: 'Riyá', partner2_name: 'Kabir Singh' }));
  assert.match(slug, /^riya-kabirsingh-[0-9a-f]{8}$/);
  assert.ok(makeToken().length >= 24);
  assert.notEqual(makeToken(), makeToken());
});

test('every Agent Skill parses and its folder matches its name', () => {
  const menu = skillMenu();
  assert.deepEqual(menu.map((s) => s.name).sort(), ['card-designer', 'guest-data-guardrails', 'saathi-concierge', 'wedding-intake']);
  for (const s of menu) assert.ok(s.description.length > 40, `${s.name} needs a real description`);
  assert.ok(getSkill('wedding-intake').body.includes('Never invent'));
  assert.match(loadSkills('saathi-concierge', 'guest-data-guardrails'), /# Skill: saathi-concierge[\s\S]+# Skill: guest-data-guardrails/);
});

test('query cells: dates become YYYY-MM-DD from either driver', () => {
  assert.equal(cell(new Date('2027-02-12T00:00:00.000Z')), '2027-02-12');
  assert.equal(cell(new Date(2027, 1, 12)), '2027-02-12');
  assert.equal(cell(10n), 10);
  assert.equal(cell('x'), 'x');
});
