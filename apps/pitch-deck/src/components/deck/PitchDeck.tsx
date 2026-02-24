import { motion, AnimatePresence } from "framer-motion";
import Navigation, { useSlideNavigation } from "./Navigation";
import SlideTitle from "./slides/SlideTitle";
import SlideProblem from "./slides/SlideProblem";
import SlideWhatBreaks from "./slides/SlideWhatBreaks";
import SlideWhatIsLedger from "./slides/SlideWhatIsLedger";
import SlideDroviLedger from "./slides/SlideDroviLedger";
import SlideWorldBrain from "./slides/SlideWorldBrain";
import SlideWorldTwin from "./slides/SlideWorldTwin";
import SlideWorldSurfaces from "./slides/SlideWorldSurfaces";
import SlideTechArch from "./slides/SlideTechArch";
import SlideAICore from "./slides/SlideAICore";
import SlideAgents from "./slides/SlideAgents";
import SlideMarkets from "./slides/SlideMarkets";
import SlideWhyWeWin from "./slides/SlideWhyWeWin";
import SlideBusinessModel from "./slides/SlideBusinessModel";
import SlideTraction from "./slides/SlideTraction";
import SlideFuture from "./slides/SlideFuture";
import SlideTeam from "./slides/SlideTeam";
import SlideRaise from "./slides/SlideRaise";

const slides = [
  SlideTitle,
  SlideProblem,
  SlideWhatBreaks,
  SlideWhatIsLedger,
  SlideDroviLedger,
  SlideWorldBrain,
  SlideWorldTwin,
  SlideWorldSurfaces,
  SlideTechArch,
  SlideAICore,
  SlideAgents,
  SlideMarkets,
  SlideWhyWeWin,
  SlideBusinessModel,
  SlideTraction,
  SlideFuture,
  SlideTeam,
  SlideRaise,
];

const PitchDeck = () => {
  const { currentSlide, navigateTo, next, prev } = useSlideNavigation(slides.length);
  const CurrentSlide = slides[currentSlide];

  return (
    <div className="h-[100dvh] min-h-screen w-full overflow-hidden bg-background">
      <Navigation
        totalSlides={slides.length}
        currentSlide={currentSlide}
        onNavigate={navigateTo}
        onNext={next}
        onPrev={prev}
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={currentSlide}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="h-full w-full"
        >
          <CurrentSlide />
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default PitchDeck;
