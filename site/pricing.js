/* What the paid packages cost, and how somebody actually buys one.

   THIS FILE IS PUBLIC, and every field in it is meant to be read by a learner.
   No secrets — the decision that unlocks a book is made in api/main.py against
   the entitlements table, and nothing here influences it.

   It degrades field by field rather than all at once, which is what makes it
   usable before every answer is known:

     nothing filled in  → no offer card at all, just the explanation
     contact only       → "write to me" — enough to sell by hand
     price added        → the card shows what it costs
     link added         → a pay button appears above the contact line

   The book and question counts under each price are NOT written here. They are
   counted from data/index.json when the card renders, so moving a book between
   tiers in tools/tiers.json updates the offer by itself and cannot leave a
   stale "5 books" sitting next to four. */
window.PRICING = {

  // Where a buyer reaches you. Until a payment provider is wired up, granting is
  // manual (api/README.md), so this is the step the whole flow rests on — and
  // while there is no payment link, it is also the call to action.
  contact: {
    label: '@alacorda',
    href: 'https://t.me/alacorda',
    // The button text when this is the primary action, i.e. no pay link yet.
    cta: { kk: 'Telegram арқылы жазу', en: 'Message on Telegram' }
  },

  // A Kaspi number could go here and would be shown as copyable text. It is
  // deliberately empty: a personal number on a public page collects spam and
  // stray transfers from people who never write, and since a buyer has to
  // message anyway to get their access, the number is better said there.
  kaspi: '',

  // Keys must match the skus in tools/tiers.json exactly. A package listed here
  // that no book points at simply never appears.
  packages: {
    ielts: {
      title: { kk: 'IELTS дайындық', en: 'IELTS preparation' },
      // Not decided yet. 0 hides the price line; the card still sells through
      // the contact button. Set a number when you have one — no other change.
      price: 0,
      currency: '₸',
      // Kaspi Gold "Ссылка для перевода", if a permanent one ever exists.
      link: '',
      note: {
        kk: 'Емтиханға дайындалып жүргендерге',
        en: 'For anyone sitting the exam'
      }
    },
    advanced: {
      title: { kk: 'Жоғары деңгей', en: 'Advanced shelf' },
      price: 0,
      currency: '₸',
      link: '',
      note: {
        kk: 'B2-ден жоғары: грамматика, академиялық және іскери лексика',
        en: 'B2 and up: grammar, academic and business vocabulary'
      }
    }
  }
};
