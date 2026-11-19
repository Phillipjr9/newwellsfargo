import checkingIcon from "./assets/checking-icon.png";
import studentIcon from "./assets/student-icon.png";
import autographIcon from "./assets/autograph-icon.png";
import journeyIcon from "./assets/journey-icon.png";
import creditCardIcon from "./assets/credit-card-icon.png";
import goalsImage from "./assets/guidance-goals.jpg";
import borrowingImage from "./assets/guidance-borrowing.jpg";
import lifeSyncImage from "./assets/guidance-lifesync.jpg";
import volunteersImage from "./assets/community-volunteers.jpg";
import greenhouseImage from "./assets/community-greenhouse.jpg";

export const CHECKING_OFFER_URL = "https://accountoffers.wellsfargo.com/checkingoffer/?sub_channel=WEB&vendor_code=WF&collateral_code=HPPB1549Q426";
export const ONEKEY_OFFER_URL = "/credit-cards/one-key-credit-card/";

export type Promotion = {
  icon: string;
  title: string;
  body: string;
  href: string;
  cta: string;
};

export const PROMOTIONS: (Promotion & { mobile?: Promotion })[] = [
  {
    icon: checkingIcon,
    title: "Get started with a $125 banking bonus",
    body: "Clear Access Banking is great for students or anyone starting fresh. New customers only.",
    href: "/checking?plan=clear-access",
    cta: "Learn more",
    mobile: {
      icon: studentIcon,
      title: "New customer? Say hello to a $125 bonus",
      body: "Open a Clear Access Banking account, great for students & more, complete offer requirements",
      href: "/checking?plan=clear-access",
      cta: "See offer details",
    },
  },
  {
    icon: autographIcon,
    title: "Earn 20,000 bonus points",
    body: "Plus, earn 3X points on many everyday categories with $0 annual fee. Terms apply.",
    href: "/credit-cards?card=autograph",
    cta: "Learn more",
    mobile: {
      icon: journeyIcon,
      title: "Earn 60,000 bonus points",
      body: "when you spend $4,000 in purchases in the first 3 months. Terms apply.",
      href: "/credit-cards?card=journey",
      cta: "Learn more",
    },
  },
  {
    icon: creditCardIcon,
    title: "Find a credit card",
    body: "Low intro rate, cash back, rewards and more",
    href: "/credit-cards",
    cta: "Learn more",
  },
];

export type Story = Omit<Promotion, "icon"> & { image: string };

export const GUIDANCE_STORIES: Story[] = [
  {
    image: goalsImage,
    title: "Your dreams, your plan",
    body: "Start crafting the foundation for the future you see yourself in",
    cta: "Get started",
    href: "/financial-goals/",
  },
  {
    image: borrowingImage,
    title: "Borrowing built around you",
    body: "Discover borrowing designed for every step of your journey",
    cta: "Explore borrowing",
    href: "/financial-goals/borrow/",
  },
  {
    image: lifeSyncImage,
    title: "Step into your future",
    body: "Track goals and get insights for your financial future with LifeSync\u00ae",
    cta: "Discover how",
    href: "/guidance",
  },
];

export const COMMUNITY_STORIES: Story[] = [
  {
    image: volunteersImage,
    title: "Who we are",
    body: "Wells Fargo helps strengthen communities through inclusion, economic empowerment, and sustainability.",
    cta: "About Wells Fargo",
    href: "/about/",
  },
  {
    image: greenhouseImage,
    title: "Why we're committed to communities",
    body: "We don't just serve our communities; we are our communities. We're committed to helping customers and neighborhoods across the country thrive.",
    cta: "Wells Fargo Stories",
    href: "/about/",
  },
];