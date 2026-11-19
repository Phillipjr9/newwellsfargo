import { Marquee, ProductDirectory } from "../components/Marquee";
import {
  CommunitiesSection,
  FargoSection,
  GuidanceSection,
  OfferTiles,
  OneKeyPromo,
  type OutsideLinkHandler,
} from "../components/ContentSections";
import { ContactBar } from "../components/Support";

export default function HomePage({ onLeave }: { onLeave: OutsideLinkHandler }) {
  return (
    <main id="main-content" className="site-width" tabIndex={-1}>
      <Marquee />
      <ProductDirectory />
      <OfferTiles />
      <OneKeyPromo />
      <GuidanceSection />
      <FargoSection onLeave={onLeave} />
      <CommunitiesSection />
      <ContactBar />
    </main>
  );
}
