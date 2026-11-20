// The Meera & Rohan sample wedding. The server creates one shared, read-only
// demo wedding from it (server/demo.ts); every signed-in user sees that demo.
import type { WeddingDraft } from './api.ts';

export const SAMPLE_DRAFT: WeddingDraft = {
  partner1_name: 'Meera',
  partner2_name: 'Rohan',
  partner1_family: 'Daughter of Sunita & Rajesh Verma',
  partner2_family: 'Son of Kavita & Anil Malhotra',
  invite_line: 'With the blessings of our elders, we joyfully invite you to celebrate our union.',
  city: 'Jaipur',
  tradition: 'North Indian',
  language: 'English & Hindi',
  style: 'royal-rajasthani',
  events: [
    {
      name: 'Haldi',
      date: '2027-02-11',
      start_time: '11:00',
      venue_name: 'Rambagh Courtyard',
      venue_address: 'Bhawani Singh Road, Jaipur',
      dress_code: 'Shades of yellow & marigold',
      notes: 'Followed by traditional Rajasthani lunch.',
    },
    {
      name: 'Mehendi & Sangeet',
      date: '2027-02-11',
      start_time: '18:30',
      venue_name: 'Jaigarh Lawns',
      venue_address: 'Amer Road, Jaipur',
      dress_code: 'Festive Indo-Western',
      notes: 'Family performances start at 8:00 PM.',
    },
    {
      name: 'Baraat & Pheras',
      date: '2027-02-12',
      start_time: '17:00',
      venue_name: 'City Palace Gardens',
      venue_address: 'Tulsi Marg, Jaipur',
      dress_code: 'Traditional Indian ethnic',
      notes: 'Baraat assembly at the main gate at 5:00 PM.',
    },
    {
      name: 'Reception',
      date: '2027-02-13',
      start_time: '19:30',
      venue_name: 'Sawai Man Mahal',
      venue_address: 'Bhawani Singh Road, Jaipur',
      dress_code: 'Formal Indian or Western',
      notes: 'Valet parking available at the main porch.',
    },
  ],
  info: [
    { question: 'Is there airport pickup?', answer: 'Yes — share your flight details in the RSVP and our hospitality desk will arrange a cab.' },
    { question: 'Is Jain food available?', answer: 'Yes, a dedicated Jain counter is arranged at every ceremony.' },
    { question: 'Is parking available?', answer: 'Complimentary valet parking is available at all venues.' },
  ],
  contact_name: 'Rohan Malhotra',
  contact_phone: '',
};
