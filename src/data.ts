export function bankUrl(path: string) {
  // All internal banking routes stay inside our full-stack SPA
  return path;
}

export const SIGN_ON_URL = "/login";
export const APPOINTMENT_URL = "/appointments";
export const LOCATIONS_URL = "/locations";

export interface MenuLink {
  label: string;
  href: string;
  desc?: string;
}

export interface MenuGroup {
  title: string;
  links: MenuLink[];
}

export interface MenuCategory {
  id: string;
  label: string;
  href: string;
  // Featured products shown at the top of the panel
  featured?: MenuLink[];
  groups?: MenuGroup[];
}

export const PRODUCT_NAV = [
  { label: "Checking", href: "/checking/", icon: "-20px -294px" },
  { label: "Savings & CDs", href: "/savings-cds/", icon: "-76px -294px" },
  { label: "Credit Cards", href: "/credit-cards/", icon: "-132px -294px" },
  { label: "Home Loans", href: "/mortgage/", icon: "-187px -294px" },
  { label: "Personal Loans", href: "/personal-loans/", icon: "-243px -294px" },
  { label: "Auto Loans", href: "/auto-loans/", icon: "-299px -293px" },
  { label: "Investing", href: "/investing-wealth/", icon: "-356px -294px" },
  { label: "Premier", href: "/premier/", icon: "-412px -294px" },
  { label: "Financial Guidance", href: "/guidance/", icon: "-469px -294px" },
];

export const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: "checking",
    label: "Checking",
    href: "/checking/",
    featured: [
      { label: "View all checking accounts", href: "/checking/" },
      { label: "Compare checking accounts", href: "/checking/compare-checking-accounts/" },
    ],
    groups: [
      {
        title: "Accounts",
        links: [
          {
            label: "Clear Access Banking",
            href: "/checking/clear-access-banking/",
            desc: "An account that helps you spend only what you have in it",
          },
          {
            label: "Prime Checking",
            href: "/checking/prime/",
            desc: "Many discounts and benefits are included with this interest-bearing account",
          },
          {
            label: "Everyday Checking",
            href: "/checking/everyday/",
            desc: "Our most popular account for managing day-to-day financial needs",
          },
          {
            label: "Premier Checking",
            href: "/checking/premier/",
            desc: "An interest-bearing account with our premier level of relationship banking benefits",
          },
          {
            label: "Student/teen banking",
            href: "/checking/student/",
            desc: "Account options ideal for teens and students",
          },
        ],
      },
      {
        title: "Banking services",
        links: [
          { label: "Routing and account numbers", href: "/help/routing-number/" },
          { label: "Overdraft services", href: "/checking/overdraft-services/" },
          { label: "Security and fraud", href: "/privacy-security/fraud/" },
          { label: "Checking FAQs", href: "/help/checking-savings/" },
          { label: "Global remittance", href: "/international-remittances/" },
          { label: "Make an appointment", href: APPOINTMENT_URL },
          { label: "Foreign exchange", href: "/foreign-exchange/" },
          { label: "Debit card", href: "/debit-card/" },
        ],
      },
      {
        title: "Digital banking",
        links: [
          { label: "Wells Fargo Online®", href: "/mobile-online-banking/" },
          { label: "Wells Fargo Mobile® app", href: "/mobile-online-banking/apps/" },
          { label: "Transfer and pay", href: "/mobile-online-banking/transfer-pay/" },
          { label: "Report fraud", href: "/privacy-security/fraud/report/" },
        ],
      },
    ],
  },
  {
    id: "savings",
    label: "Savings & CDs",
    href: "/savings-cds/",
    featured: [
      { label: "View all savings accounts", href: "/savings-cds/" },
      { label: "Check all rates", href: "/savings-cds/rates/" },
    ],
    groups: [
      {
        title: "Accounts",
        links: [
          {
            label: "Way2Save® Savings",
            href: "/savings-cds/way2save/",
            desc: "Build your savings automatically",
          },
          {
            label: "Platinum Savings",
            href: "/savings-cds/platinum/",
            desc: "Grow your savings with more ways to access your money",
          },
          {
            label: "Wells Fargo CDs",
            href: "/savings-cds/certificate-of-deposit/",
            desc: "Provide a guaranteed rate of return, even during uncertain times",
          },
          {
            label: "Kids Savings",
            href: "/savings-cds/kids/",
            desc: "A good way to start your children on the road to financial success",
          },
        ],
      },
      {
        title: "Banking services",
        links: [
          { label: "Routing and account numbers", href: "/help/routing-number/" },
          { label: "Tax center", href: "/tax-center/" },
          { label: "Security and fraud", href: "/privacy-security/fraud/" },
          { label: "Savings FAQs", href: "/help/checking-savings/" },
          { label: "Global remittance", href: "/international-remittances/" },
          { label: "Make an appointment", href: APPOINTMENT_URL },
          { label: "Foreign exchange", href: "/foreign-exchange/" },
        ],
      },
      {
        title: "Digital banking",
        links: [
          { label: "Wells Fargo Online®", href: "/mobile-online-banking/" },
          { label: "Wells Fargo Mobile® app", href: "/mobile-online-banking/apps/" },
          { label: "Transfer and pay", href: "/mobile-online-banking/transfer-pay/" },
        ],
      },
    ],
  },
  {
    id: "cards",
    label: "Credit Cards",
    href: "/credit-cards/",
    featured: [
      { label: "View all credit cards", href: "/credit-cards/" },
      {
        label: "See if you're prequalified",
        href: "https://web.secure.wellsfargo.com/credit-cards/yourinfo/",
      },
    ],
    groups: [
      {
        title: "Credit cards",
        links: [
          { label: "Cash back credit cards", href: "/credit-cards/cash-back-credit-cards/" },
          { label: "Rewards credit cards", href: "/credit-cards/rewards-credit-cards/" },
          { label: "0% intro APR credit cards", href: "/credit-cards/0-percent-intro-apr-credit-cards/" },
          { label: "Travel credit cards", href: "/credit-cards/travel-credit-cards/" },
          { label: "Balance transfer credit cards", href: "/credit-cards/balance-transfer-credit-cards/" },
          { label: "Business credit card", href: "/credit-cards/business-credit-cards/" },
        ],
      },
      {
        title: "Credit card services",
        links: [
          { label: "Confirm credit card", href: "https://confirmcard.wellsfargo.com/" },
          { label: "Wells Fargo Rewards®", href: "/rewards/" },
          { label: "Request a balance transfer", href: "https://www.wellsfargo.com/credit-cards/features/balance-transfer/" },
          { label: "Wells Fargo Entertainment", href: "https://entertainment.wf.com/" },
        ],
      },
      {
        title: "Education & tools",
        links: [
          { label: "Respond to mail offer", href: "/wf/product/apply?prodCode=CC&language=en&applicationtype=creditcarddirectmail" },
          { label: "Digital wallets", href: "/mobile/payments/" },
          { label: "Credit card FAQs", href: "/help/credit-cards/credit-card-faqs/" },
          { label: "FICO® Credit Score", href: "/goals-credit/smarter-credit/credit-101/fico/" },
          { label: "Credit card education", href: "/credit-cards/credit-cards-education/" },
        ],
      },
    ],
  },
  {
    id: "mortgage",
    label: "Home Loans",
    href: "/mortgage/",
    featured: [
      { label: "View home loans", href: "/mortgage/" },
      { label: "Get a personalized rate quote", href: "/mortgage/rate-quote/" },
    ],
    groups: [
      {
        title: "Home loans",
        links: [
          { label: "Buy a home", href: "/mortgage/buying-a-house/", desc: "" },
          { label: "Refinance your mortgage", href: "/mortgage/mortgage-refinance/" },
          { label: "Check mortgage rates", href: "/mortgage/rates/" },
          { label: "First-time homebuyer programs", href: "/mortgage/buying-a-house/affordable-options/" },
          { label: "Compare loan types", href: "/mortgage/loan-programs/" },
          { label: "Offers for existing customers", href: "/mortgage/relationship-offers/" },
        ],
      },
      {
        title: "Mortgage services",
        links: [
          { label: "See what you can afford", href: "https://web.secure.wellsfargo.com/mortgage/get-prequalified/" },
          { label: "Shop for homes", href: "/mortgage/come-home/" },
          { label: "Start your application", href: "/mortgage/apply/" },
          { label: "Manage your account", href: "/mortgage/manage-account/" },
        ],
      },
      {
        title: "Education & tools",
        links: [
          { label: "Mortgage calculators", href: "/mortgage/calculators/" },
          { label: "Explore the learning center", href: "/mortgage/learn/" },
          { label: "Renting versus buying", href: "/mortgage/learn/compare-cost-of-renting-vs-buying-a-home/" },
          { label: "Down payment options", href: "/mortgage/learn/how-much-do-you-need-for-a-down-payment/" },
          { label: "Homeownership and taxes", href: "/mortgage/learn/understanding-homeowner-taxes/" },
          { label: "Guide to escrow accounts", href: "/mortgage/learn/escrow-accounts/" },
        ],
      },
    ],
  },
  {
    id: "personal-loans",
    label: "Personal Loans",
    href: "/personal-loans/",
    featured: [{ label: "See your loan options", href: "https://icomplete.wellsfargo.com/oas/status/personal-loans-rate-checker/getting-started/" }],
    groups: [
      {
        title: "Personal loans",
        links: [
          {
            label: "Personal loans",
            href: "/personal-loans/",
            desc: "Learn how a personal loan can help fund life's major milestones and unexpected expenses",
          },
          {
            label: "Loans for home improvement",
            href: "/personal-loans/home-improvement/",
            desc: "Use a personal loan to pay for home renovations and repairs",
          },
          {
            label: "Finance a large expense",
            href: "/personal-loans/uses-of-a-personal-loan/",
            desc: "Pay for new appliances, car repairs, medical expenses, and more",
          },
          {
            label: "Consolidate debt",
            href: "/personal-loans/debt-consolidation/",
            desc: "Combine your higher-interest debt into one manageable payment",
          },
        ],
      },
      {
        title: "Personal loan services",
        links: [
          { label: "How to apply for a loan", href: "/help/loans/personal-loan-faqs/#howdoiapplyforaloan" },
          { label: "How to make a payment", href: "/help/loans/personal-loan-faqs/#paymentsandfees" },
        ],
      },
      {
        title: "Education & tools",
        links: [
          { label: "Check your rate and loan options", href: "https://icomplete.wellsfargo.com/oas/status/personal-loans-rate-checker/getting-started/" },
          { label: "Debt consolidation calculator", href: "/personal-loans/debt-consolidation-calculator/" },
          { label: "Understanding credit and debt", href: "/financial-health/credit-and-debt/" },
          { label: "Explore the learning center", href: "/personal-loans/learn/" },
        ],
      },
    ],
  },
  {
    id: "auto",
    label: "Auto Loans",
    href: "/auto-loans/",
    featured: [{ label: "Explore auto loans", href: "/auto-loans/" }],
    groups: [
      {
        title: "Auto loans",
        links: [
          {
            label: "Current auto loan customers",
            href: SIGN_ON_URL,
            desc: "Sign in to make payments, view statements, set up alerts, and more",
          },
          {
            label: "Vehicle financing",
            href: "/auto-loans/vehicle-financing-101/",
            desc: "New and used vehicle financing through your dealer",
          },
          {
            label: "Enroll in Wells Fargo Online®",
            href: "/enroll",
            desc: "Use online banking to manage your auto loan",
          },
        ],
      },
      {
        title: "Auto loan services",
        links: [
          { label: "Other ways to make a payment", href: "/auto-loans/make-payments/" },
          { label: "Wells Fargo Mobile® app", href: "/mobile-online-banking/apps/" },
        ],
      },
      {
        title: "Education & tools",
        links: [{ label: "Auto loan FAQs", href: "/help/loans/auto-loans-faqs/" }],
      },
    ],
  },
  {
    id: "premier",
    label: "Premier",
    href: "/premier/",
    featured: [{ label: "Premier services overview", href: "/premier/" }],
    groups: [
      {
        title: "Premier",
        links: [
          {
            label: "Introducing Wells Fargo Premier",
            href: "/premier/",
            desc: "Elevate your financial expectations",
          },
          {
            label: "Premier Checking",
            href: "/checking/premier/",
            desc: "An interest-bearing account with our premier level of relationship banking benefits",
          },
        ],
      },
      {
        title: "Banking services",
        links: [
          { label: "Routing and account numbers", href: "/help/routing-number/" },
          { label: "Overdraft services", href: "/checking/overdraft-services/" },
          { label: "Security and fraud", href: "/privacy-security/fraud/" },
          { label: "Checking FAQs", href: "/help/checking-savings/" },
          { label: "Global remittance", href: "/international-remittances/" },
          { label: "Make an appointment", href: APPOINTMENT_URL },
          { label: "Foreign exchange", href: "/foreign-exchange/" },
        ],
      },
      {
        title: "Digital banking",
        links: [
          { label: "Wells Fargo Online®", href: "/mobile-online-banking/" },
          { label: "Wells Fargo Mobile® app", href: "/mobile-online-banking/apps/" },
          { label: "Transfer and pay", href: "/mobile-online-banking/transfer-pay/" },
          { label: "Report fraud", href: "/privacy-security/fraud/report/" },
        ],
      },
    ],
  },
  {
    id: "guidance",
    label: "Financial Guidance",
    href: "/guidance",
    featured: [
      { label: "Get Money Ready", href: "/guidance" },
      { label: "LifeSync", href: "/mobile-online-banking/lifesync/" },
    ],
    groups: [
      {
        title: "Financial guidance",
        links: [
          {
            label: "Guided coaching",
            href: "/guidance/guided-financial-coaching/",
            desc: "Get practical guidance based on your priorities",
          },
          {
            label: "Money goals",
            href: "/guidance/money-goals/",
            desc: "Choose a goal that matters to you and take the next step",
          },
          {
            label: "Learning center",
            href: "/guidance/learning-center/",
            desc: "Explore personal finance tips and articles",
          },
        ],
      },
    ],
  },
];

// Top-level drawer links that have no sub-panel
export const MENU_LINKS: MenuLink[] = [
  { label: "Investing & Wealth Management", href: "/investing-wealth/" },
  { label: "Business Banking", href: "/biz/" },
  { label: "Commercial Banking", href: "/com/" },
  { label: "Corporate & Investment Banking", href: "/cib/" },
  { label: "About Wells Fargo", href: "/about/" },
  { label: "ATMs/Locations", href: LOCATIONS_URL },
  { label: "Customer service and FAQs", href: "/help/" },
  { label: "Español", href: "/es/" },
];

export const HELP_FAQS = [
  { label: "How do I find my routing and account numbers?", href: "/help/routing-number/" },
  { label: "Is there a fee for Zelle®?", href: "/help/online-banking/zelle-faqs/#isthereafeeforzelle" },
  { label: "How do I report suspected fraud?", href: "/privacy-security/fraud/report/" },
];

export const RATE_OPTIONS = [
  { value: "mortgage", label: "Mortgage rates" },
  { value: "savings", label: "Savings and CDs rates" },
  { value: "cards", label: "Credit card rates" },
  { value: "personal", label: "Personal loan rates" },
  { value: "all", label: "All rates" },
];

export const RATE_HREFS: Record<string, string> = {
  mortgage: "/mortgage",
  savings: "/savings-cds",
  cards: "/credit-cards",
  personal: "/personal-loans",
  all: "/help/rates",
};

export const FOOTER_LINKS = [
  { label: "Privacy, Cookies, Security & Legal", href: "/privacy-security/" },
  { label: "Do Not Sell or Share My Personal Information", href: "/privacy-security/opt-out-notice/" },
  { label: "Notice of Data Collection", href: "/privacy-security/notice-of-data-collection/" },
  { label: "General Terms of Use", href: "/privacy-security/terms/" },
  { label: "Online Access Agreement", href: "/online-banking/online-access-agreement/" },
  { label: "Report Fraud", href: "/privacy-security/fraud/report/" },
  { label: "About Wells Fargo", href: "/about/" },
  { label: "Careers", href: "/careers/" },
  { label: "Inclusion and Accessibility", href: "/about/" },
  { label: "Sitemap", href: "/sitemap/" },
];

export const SOCIAL = [
  { label: "Facebook", href: "https://www.facebook.com/wellsfargo/", icon: "-130px -73px" },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/wellsfargo/", icon: "-174px -73px" },
  { label: "Instagram", href: "https://www.instagram.com/wellsfargo/", icon: "-219px -73px" },
  { label: "Pinterest", href: "https://www.pinterest.com/wellsfargo/", icon: "-264px -73px" },
  { label: "YouTube", href: "https://www.youtube.com/user/wellsfargo/", icon: "-310px -73px" },
  { label: "X (Twitter)", href: "https://www.twitter.com/wellsfargo/", icon: "-356px -73px" },
];

export const APP_STORE_URL =
  "https://apps.apple.com/us/app/wells-fargo-mobile/id311548709?ppid=61927db7-dd56-4349-af8d-6080fa7dc048";
export const GOOGLE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.wf.wellsfargomobile&listing=h_p_p_10_24";
