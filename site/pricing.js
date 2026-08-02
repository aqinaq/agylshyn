/* What a subscription costs, and how somebody actually buys one.

   THIS FILE IS PUBLIC, and every field in it is meant to be read by a learner.
   No secrets: the decision that unlocks a book is made by a row-level policy in
   Postgres against the subscriptions table, and nothing here influences it.
   Editing these numbers in devtools changes the price on a card and nothing
   about what the server will hand over.

   It degrades field by field rather than all at once, which is what makes it
   usable before every answer is known:

     nothing filled in  → no offer at all, just the explanation
     contact only       → "write to me" — enough to sell by hand
     price added        → the plan shows what it costs
     link added         → a pay button appears above the contact line

   How many books and questions a subscription covers is NOT written here. It is
   counted from data/index.json when the card renders, so moving a book in or out
   of tools/tiers.json updates the offer by itself and cannot leave a stale
   "8 books" sitting next to seven. */
window.PRICING = {

  // Where a buyer reaches you. Granting is manual — you see the transfer, you
  // press the button in #/users — so this is the step the whole flow rests on.
  contact: {
    label: '@alacorda',
    href: 'https://t.me/alacorda',
    // The button text when this is the primary action, i.e. no pay link yet.
    cta: { kk: 'Telegram арқылы жазу', en: 'Message on Telegram' }
  },

  // A Kaspi number, shown as copyable text under the price. Empty by default: a
  // personal number on a public page collects spam and stray transfers from
  // people who never write, and since a buyer has to send their email address
  // anyway to get unlocked, the number is better said in that conversation.
  kaspi: '',

  // The two plans. Keys are the plan names the database uses ('monthly' and
  // 'lifetime' — see the check constraint in tools/supabase_schema.sql); adding
  // a third here without adding it there would draw a card nobody can grant.
  plans: {
    monthly: {
      title: { kk: 'Айлық', en: 'Monthly' },
      price: 2000,
      currency: '₸',
      per: { kk: '/ ай', en: '/ month' },
      // Kaspi Gold → "Ссылка для перевода". Paste it here and the card grows a
      // pay button; until then the button writes to you instead.
      link: '',
      note: {
        kk: 'Бір айға. Айдың соңында тағы төлесең, күндер үстіне қосылады.',
        en: 'One month. Pay again at the end and the days are added on top.'
      }
    },
    lifetime: {
      title: { kk: 'Мәңгілік', en: 'Lifetime' },
      price: 5000,
      currency: '₸',
      per: { kk: 'бір рет', en: 'once' },
      link: '',
      // Drawn with the accent border and shown second, because it is the one
      // worth taking: two and a half months of the monthly plan and it never
      // has to be thought about again.
      best: true,
      note: {
        kk: 'Бір рет төлейсің, мерзімі бітпейді. Кейін қосылған кітаптар да кіреді.',
        en: 'Paid once, never expires. Books added later are included.'
      }
    }
  }
};
