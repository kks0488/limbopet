// Pet characters (mood-based)
import petHappy from "./pet-happy.svg";
import petNeutral from "./pet-neutral.svg";
import petSad from "./pet-sad.svg";
import petAngry from "./pet-angry.svg";
import petSleepy from "./pet-sleepy.svg";
import petExcited from "./pet-excited.svg";

// Job icons
import jobBarista from "./job-barista.svg";
import jobJournalist from "./job-journalist.svg";
import jobEngineer from "./job-engineer.svg";
import jobMerchant from "./job-merchant.svg";
import jobDetective from "./job-detective.svg";
import jobJanitor from "./job-janitor.svg";

// Action icons
import actionFeed from "./action-feed.svg";
import actionPlay from "./action-play.svg";
import actionSleep from "./action-sleep.svg";
import actionTalk from "./action-talk.svg";

// UI icons
import uiStreakFire from "./ui-streak-fire.svg";
import uiCoin from "./ui-coin.svg";
import uiXpStar from "./ui-xp-star.svg";
import uiBell from "./ui-bell.svg";
import uiShield from "./ui-shield.svg";
import uiTrophy from "./ui-trophy.svg";

// Backgrounds
import bgHero from "./bg-hero.svg";
import bgEmpty from "./bg-empty.svg";
import bgOnboarding from "./bg-onboarding.svg";

// Logo
import logo from "./logo.svg";
import logoIcon from "./logo-icon.svg";

export const petMoodMap: Record<string, string> = {
  bright: petHappy,
  okay: petNeutral,
  low: petSad,
  gloomy: petAngry,
  sleepy: petSleepy,
  excited: petExcited,
};

export const jobIconMap: Record<string, string> = {
  barista: jobBarista,
  journalist: jobJournalist,
  engineer: jobEngineer,
  merchant: jobMerchant,
  detective: jobDetective,
  janitor: jobJanitor,
};

export const actionIconMap: Record<string, string> = {
  feed: actionFeed,
  play: actionPlay,
  sleep: actionSleep,
  talk: actionTalk,
};

export {
  petHappy, petNeutral, petSad, petAngry, petSleepy, petExcited,
  jobBarista, jobJournalist, jobEngineer, jobMerchant, jobDetective, jobJanitor,
  actionFeed, actionPlay, actionSleep, actionTalk,
  uiStreakFire, uiCoin, uiXpStar, uiBell, uiShield, uiTrophy,
  bgHero, bgEmpty, bgOnboarding,
  logo, logoIcon,
};
