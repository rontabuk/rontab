export const informationPages = [
  {
    slug: "about",
    label: "About",
    eyebrow: "A little about us",
    title: "A more considered way to find things for home.",
    intro: "Rontab is being shaped as a place to discover useful, characterful home and kitchen pieces from independent makers and thoughtful brands.",
    sections: [
      { heading: "A good place to begin", body: "The first collection is a design exercise: every product, maker, image, and price shown on this site is fictional demonstration content. No purchase is available." },
      { heading: "Made for discovery", body: "The longer-term idea is a focused catalogue that helps people find the things they need, then visit the independent shop that sells them." },
    ],
  },
  {
    slug: "contact",
    label: "Contact",
    eyebrow: "Say hello",
    title: "Good conversations make good beginnings.",
    intro: "Rontab is in an early demonstration phase. Contact details will be added before the service opens to the public.",
    sections: [
      { heading: "For now", body: "There is no monitored support inbox yet. Please treat this page as a placeholder rather than a live customer-support channel." },
    ],
  },
  {
    slug: "privacy",
    label: "Privacy",
    eyebrow: "Privacy notice · draft",
    title: "Your privacy deserves more than placeholder copy.",
    intro: "This demonstration does not include accounts, analytics, or product tracking. A complete privacy notice must be prepared before any personal data is collected.",
    sections: [
      { heading: "Before launch", body: "The final notice will explain what data is collected, why it is used, how long it is kept, and how people can exercise their rights under applicable UK and European data-protection laws." },
    ],
  },
  {
    slug: "terms",
    label: "Terms",
    eyebrow: "Terms · draft",
    title: "Clear terms, before anything goes live.",
    intro: "These sample pages are not legal terms. The catalogue is a non-transactional prototype with fictional listings and example.com links.",
    sections: [
      { heading: "A note on external links", body: "The finished service is intended to direct visitors to independent retailers. It will not process orders or guarantee product availability unless that changes in a later release." },
    ],
  },
  {
    slug: "cookie-preferences",
    label: "Cookie preferences",
    eyebrow: "Your choices",
    title: "No preference centre is active yet.",
    intro: "This prototype has no non-essential tracking or advertising cookies. A working preference centre will be added if the finished service uses technologies that require consent.",
    sections: [
      { heading: "Before launch", body: "Cookie use and consent requirements will be reviewed for the markets Rontab serves before any optional tracking is enabled." },
    ],
  },
  {
    slug: "seller-terms",
    label: "Seller terms",
    eyebrow: "Seller terms · draft",
    title: "A fair foundation for sellers.",
    intro: "Seller applications and product review are available in early access. Subscriptions and billing are not active yet.",
    sections: [
      { heading: "Before paid plans", body: "Final terms will set out image and description rights, subscription prices, click qualification, cancellation, and billing. Those decisions remain open in the product specification." },
    ],
  },
  {
    slug: "for-sellers",
    label: "For sellers",
    eyebrow: "A note for independent brands",
    title: "A thoughtful shop window starts with good makers.",
    intro: "Rontab helps independent home and kitchen brands put their work in front of people who are looking for it.",
    sections: [
      { heading: "Apply to sell", body: "Create a shop profile to apply. New shops remain private while the Rontab team reviews the application." },
      { heading: "Product review", body: "Approved sellers can submit products with an image, description, price, category, and secure shop link. Each listing is reviewed before it appears publicly." },
      { heading: "Early access", body: "Seller subscriptions and billing are not active yet. Demo products shown during local development are fictional examples." },
    ],
  },
] as const;