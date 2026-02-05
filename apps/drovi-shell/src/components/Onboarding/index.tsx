import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Building2,
  Users,
  Plug,
  Shield,
  Keyboard,
  Sparkles,
  Mail,
  MessageSquare,
  Calendar,
  FileText,
  Zap,
} from "lucide-react";
import { useAuthStore } from "../../store/authStore";

type OnboardingStep = "welcome" | "organization" | "connections" | "privacy" | "shortcuts" | "complete";

const STEPS: OnboardingStep[] = ["welcome", "organization", "connections", "privacy", "shortcuts", "complete"];

const STEP_INFO: Record<OnboardingStep, { title: string; description: string }> = {
  welcome: {
    title: "Welcome to Drovi",
    description: "Your AI-powered memory for everything that matters",
  },
  organization: {
    title: "Set Up Your Organization",
    description: "Tell us about your team to personalize your experience",
  },
  connections: {
    title: "Connect Your Sources",
    description: "Import your emails, messages, and documents",
  },
  privacy: {
    title: "Privacy Settings",
    description: "Control what Drovi can access and store",
  },
  shortcuts: {
    title: "Master the Keyboard",
    description: "Learn the shortcuts to navigate like a pro",
  },
  complete: {
    title: "You're All Set!",
    description: "Start exploring your new Memory OS",
  },
};

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [orgData, setOrgData] = useState({
    name: "",
    role: "",
    teamSize: "",
  });
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [privacySettings, setPrivacySettings] = useState({
    screenshots: true,
    accessibility: true,
    ocr: false,
    retention: 30,
  });

  const currentIndex = STEPS.indexOf(currentStep);
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentStep === "complete";

  const nextStep = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]);
    }
  }, [currentIndex]);

  const prevStep = useCallback(() => {
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]);
    }
  }, [currentIndex]);

  const handleComplete = () => {
    // Save onboarding data and mark as complete
    localStorage.setItem("drovi_onboarding_complete", "true");
    localStorage.setItem("drovi_org_name", orgData.name);
    onComplete();
  };

  return (
    <div className="onboarding">
      {/* Progress Bar */}
      <div className="onboarding__progress">
        {STEPS.slice(0, -1).map((step, index) => (
          <div
            key={step}
            className={`onboarding__progress-step ${
              index < currentIndex ? "completed" : index === currentIndex ? "active" : ""
            }`}
          >
            <div className="onboarding__progress-dot">
              {index < currentIndex ? <Check size={12} /> : index + 1}
            </div>
            {index < STEPS.length - 2 && <div className="onboarding__progress-line" />}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="onboarding__content">
        <AnimatePresence mode="wait">
          {currentStep === "welcome" && (
            <WelcomeStep key="welcome" onNext={nextStep} />
          )}
          {currentStep === "organization" && (
            <OrganizationStep
              key="organization"
              data={orgData}
              onChange={setOrgData}
            />
          )}
          {currentStep === "connections" && (
            <ConnectionsStep
              key="connections"
              selected={selectedConnections}
              onChange={setSelectedConnections}
            />
          )}
          {currentStep === "privacy" && (
            <PrivacyStep
              key="privacy"
              settings={privacySettings}
              onChange={setPrivacySettings}
            />
          )}
          {currentStep === "shortcuts" && (
            <ShortcutsStep key="shortcuts" />
          )}
          {currentStep === "complete" && (
            <CompleteStep key="complete" orgName={orgData.name} />
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="onboarding__nav">
        {!isFirstStep && !isLastStep && (
          <button className="btn btn--ghost" onClick={prevStep}>
            <ArrowLeft size={16} />
            Back
          </button>
        )}
        {isFirstStep && <div />}

        {isLastStep ? (
          <button className="btn btn--primary" onClick={handleComplete}>
            <Sparkles size={16} />
            Start Using Drovi
          </button>
        ) : (
          <button className="btn btn--primary" onClick={nextStep}>
            Continue
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

interface WelcomeStepProps {
  onNext: () => void;
}

function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <StepWrapper step="welcome">
      <div className="onboarding__welcome">
        <div className="onboarding__welcome-icon">
          <Sparkles size={48} />
        </div>
        <h1 className="onboarding__welcome-title">Welcome to Drovi</h1>
        <p className="onboarding__welcome-subtitle">
          Your AI-powered memory for everything that matters.
          Drovi helps you track commitments, decisions, and relationships
          across all your communications.
        </p>
        <div className="onboarding__features">
          <FeatureCard
            icon={Zap}
            title="Instant Intelligence"
            description="Get AI-powered insights from your emails and messages"
          />
          <FeatureCard
            icon={Shield}
            title="Privacy First"
            description="Your data stays secure with enterprise-grade encryption"
          />
          <FeatureCard
            icon={Keyboard}
            title="Keyboard Native"
            description="Navigate everything with powerful keyboard shortcuts"
          />
        </div>
      </div>
    </StepWrapper>
  );
}

interface FeatureCardProps {
  icon: typeof Zap;
  title: string;
  description: string;
}

function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="onboarding__feature-card">
      <div className="onboarding__feature-icon">
        <Icon size={20} />
      </div>
      <div className="onboarding__feature-content">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

interface OrganizationStepProps {
  data: { name: string; role: string; teamSize: string };
  onChange: (data: { name: string; role: string; teamSize: string }) => void;
}

function OrganizationStep({ data, onChange }: OrganizationStepProps) {
  return (
    <StepWrapper step="organization">
      <div className="onboarding__form">
        <div className="onboarding__form-group">
          <label htmlFor="org-name">
            <Building2 size={16} />
            Organization Name
          </label>
          <input
            id="org-name"
            type="text"
            placeholder="Acme Corp"
            value={data.name}
            onChange={(e) => onChange({ ...data, name: e.target.value })}
          />
        </div>

        <div className="onboarding__form-group">
          <label htmlFor="role">
            <Users size={16} />
            Your Role
          </label>
          <select
            id="role"
            value={data.role}
            onChange={(e) => onChange({ ...data, role: e.target.value })}
          >
            <option value="">Select your role...</option>
            <option value="founder">Founder / CEO</option>
            <option value="executive">Executive</option>
            <option value="manager">Manager</option>
            <option value="individual">Individual Contributor</option>
            <option value="sales">Sales / Business Development</option>
            <option value="support">Customer Success / Support</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="onboarding__form-group">
          <label htmlFor="team-size">
            <Users size={16} />
            Team Size
          </label>
          <select
            id="team-size"
            value={data.teamSize}
            onChange={(e) => onChange({ ...data, teamSize: e.target.value })}
          >
            <option value="">Select team size...</option>
            <option value="1">Just me</option>
            <option value="2-10">2-10 people</option>
            <option value="11-50">11-50 people</option>
            <option value="51-200">51-200 people</option>
            <option value="200+">200+ people</option>
          </select>
        </div>
      </div>
    </StepWrapper>
  );
}

interface ConnectionsStepProps {
  selected: string[];
  onChange: (selected: string[]) => void;
}

const AVAILABLE_CONNECTIONS = [
  { id: "gmail", name: "Gmail", icon: Mail, description: "Import emails and attachments" },
  { id: "outlook", name: "Outlook", icon: Mail, description: "Microsoft 365 emails" },
  { id: "slack", name: "Slack", icon: MessageSquare, description: "Slack messages and channels" },
  { id: "calendar", name: "Google Calendar", icon: Calendar, description: "Meetings and events" },
  { id: "notion", name: "Notion", icon: FileText, description: "Pages and databases" },
];

function ConnectionsStep({ selected, onChange }: ConnectionsStepProps) {
  const toggleConnection = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <StepWrapper step="connections">
      <p className="onboarding__step-hint">
        You can connect more sources later from Settings → Connections
      </p>
      <div className="onboarding__connections-grid">
        {AVAILABLE_CONNECTIONS.map((connection) => (
          <button
            key={connection.id}
            type="button"
            className={`onboarding__connection-card ${
              selected.includes(connection.id) ? "selected" : ""
            }`}
            onClick={() => toggleConnection(connection.id)}
          >
            <div className="onboarding__connection-icon">
              <connection.icon size={24} />
            </div>
            <div className="onboarding__connection-info">
              <h4>{connection.name}</h4>
              <p>{connection.description}</p>
            </div>
            <div className="onboarding__connection-check">
              {selected.includes(connection.id) && <Check size={16} />}
            </div>
          </button>
        ))}
      </div>
      <p className="onboarding__skip-hint">
        Skip this step to connect sources later
      </p>
    </StepWrapper>
  );
}

interface PrivacyStepProps {
  settings: {
    screenshots: boolean;
    accessibility: boolean;
    ocr: boolean;
    retention: number;
  };
  onChange: (settings: {
    screenshots: boolean;
    accessibility: boolean;
    ocr: boolean;
    retention: number;
  }) => void;
}

function PrivacyStep({ settings, onChange }: PrivacyStepProps) {
  return (
    <StepWrapper step="privacy">
      <div className="onboarding__privacy">
        <div className="onboarding__privacy-card">
          <div className="onboarding__privacy-header">
            <Shield size={20} />
            <h4>Context Capture</h4>
          </div>
          <div className="onboarding__privacy-options">
            <PrivacyToggle
              label="Window Screenshots"
              description="Capture visual context from active windows"
              enabled={settings.screenshots}
              onChange={(v) => onChange({ ...settings, screenshots: v })}
            />
            <PrivacyToggle
              label="Accessibility Access"
              description="Read selected text from applications"
              enabled={settings.accessibility}
              onChange={(v) => onChange({ ...settings, accessibility: v })}
            />
            <PrivacyToggle
              label="OCR Text Extraction"
              description="Extract text from images and screenshots"
              enabled={settings.ocr}
              onChange={(v) => onChange({ ...settings, ocr: v })}
            />
          </div>
        </div>

        <div className="onboarding__privacy-card">
          <div className="onboarding__privacy-header">
            <Calendar size={20} />
            <h4>Data Retention</h4>
          </div>
          <div className="onboarding__retention-options">
            {[7, 14, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                className={`onboarding__retention-option ${
                  settings.retention === days ? "selected" : ""
                }`}
                onClick={() => onChange({ ...settings, retention: days })}
              >
                {days} days
              </button>
            ))}
          </div>
          <p className="onboarding__privacy-hint">
            Context data older than this will be automatically deleted
          </p>
        </div>
      </div>
    </StepWrapper>
  );
}

interface PrivacyToggleProps {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function PrivacyToggle({ label, description, enabled, onChange }: PrivacyToggleProps) {
  return (
    <div className="onboarding__privacy-toggle">
      <div className="onboarding__privacy-toggle-info">
        <span>{label}</span>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className={`toggle-switch ${enabled ? "enabled" : ""}`}
        onClick={() => onChange(!enabled)}
        aria-pressed={enabled}
      >
        <span className="toggle-switch-knob" />
      </button>
    </div>
  );
}

const SHORTCUTS = [
  { keys: ["⌘", "K"], description: "Command palette" },
  { keys: ["⌘", "⇧", "Space"], description: "Intent bar" },
  { keys: ["Tab"], description: "Switch modes" },
  { keys: ["↑", "↓"], description: "Navigate" },
  { keys: ["Enter"], description: "Select" },
  { keys: ["Esc"], description: "Close" },
];

function ShortcutsStep() {
  return (
    <StepWrapper step="shortcuts">
      <div className="onboarding__shortcuts">
        <p className="onboarding__shortcuts-intro">
          Drovi is designed for power users. Master these shortcuts to navigate at the speed of thought.
        </p>
        <div className="onboarding__shortcuts-grid">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.description} className="onboarding__shortcut">
              <div className="onboarding__shortcut-keys">
                {shortcut.keys.map((key, i) => (
                  <span key={`${shortcut.description}-${key}-${i}`}>
                    <kbd>{key}</kbd>
                    {i < shortcut.keys.length - 1 && <span>+</span>}
                  </span>
                ))}
              </div>
              <span className="onboarding__shortcut-desc">{shortcut.description}</span>
            </div>
          ))}
        </div>
        <div className="onboarding__shortcuts-tip">
          <Keyboard size={16} />
          <span>Press <kbd>⌘</kbd> <kbd>K</kbd> anytime to open the command palette</span>
        </div>
      </div>
    </StepWrapper>
  );
}

interface CompleteStepProps {
  orgName: string;
}

function CompleteStep({ orgName }: CompleteStepProps) {
  return (
    <StepWrapper step="complete">
      <div className="onboarding__complete">
        <div className="onboarding__complete-icon">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
          >
            <Check size={48} />
          </motion.div>
        </div>
        <h2>Welcome{orgName ? `, ${orgName}` : ""}!</h2>
        <p>Your Memory OS is ready. Here's what you can do next:</p>
        <div className="onboarding__next-steps">
          <div className="onboarding__next-step">
            <span className="onboarding__next-step-num">1</span>
            <div>
              <strong>Open the Command Palette</strong>
              <p>Press ⌘K to search, ask questions, or run commands</p>
            </div>
          </div>
          <div className="onboarding__next-step">
            <span className="onboarding__next-step-num">2</span>
            <div>
              <strong>Check Your Brief</strong>
              <p>See an AI-generated summary of your day</p>
            </div>
          </div>
          <div className="onboarding__next-step">
            <span className="onboarding__next-step-num">3</span>
            <div>
              <strong>Connect More Sources</strong>
              <p>Add email, Slack, and other integrations</p>
            </div>
          </div>
        </div>
      </div>
    </StepWrapper>
  );
}

interface StepWrapperProps {
  step: OnboardingStep;
  children: React.ReactNode;
}

function StepWrapper({ step, children }: StepWrapperProps) {
  const info = STEP_INFO[step];

  return (
    <motion.div
      className="onboarding__step"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      {step !== "welcome" && step !== "complete" && (
        <div className="onboarding__step-header">
          <h2>{info.title}</h2>
          <p>{info.description}</p>
        </div>
      )}
      {children}
    </motion.div>
  );
}

export default Onboarding;
