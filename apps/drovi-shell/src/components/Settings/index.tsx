import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  Shield,
  Keyboard,
  Palette,
  LogOut,
  ChevronRight,
  Eye,
  EyeOff,
  Camera,
  Accessibility,
  FileText,
  Clock,
  Trash2,
  Check,
} from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import { clearAuthTokens } from "../../tauri";

type SettingsSection = "account" | "privacy" | "shortcuts" | "appearance";

interface ShortcutItem {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ["⌘", "K"], description: "Open command palette" },
  { keys: ["⌘", "⇧", "Space"], description: "Toggle intent bar" },
  { keys: ["Tab"], description: "Cycle command modes" },
  { keys: ["Esc"], description: "Close / Go back" },
  { keys: ["↑", "↓"], description: "Navigate results" },
  { keys: ["Enter"], description: "Select / Execute" },
  { keys: ["⌘", "Enter"], description: "Open in detail panel" },
  { keys: ["@"], description: "Person search prefix" },
  { keys: ["#"], description: "Tag filter prefix" },
  { keys: ["/"], description: "Command prefix" },
];

export function Settings() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("account");
  const { user, organization, logout } = useAuthStore();

  const handleLogout = async () => {
    try {
      await clearAuthTokens();
      await logout();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <div className="settings-container">
      <div className="settings-sidebar">
        <h2 className="settings-title">Settings</h2>
        <nav className="settings-nav">
          <SettingsNavItem
            icon={User}
            label="Account"
            isActive={activeSection === "account"}
            onClick={() => setActiveSection("account")}
          />
          <SettingsNavItem
            icon={Shield}
            label="Privacy"
            isActive={activeSection === "privacy"}
            onClick={() => setActiveSection("privacy")}
          />
          <SettingsNavItem
            icon={Keyboard}
            label="Shortcuts"
            isActive={activeSection === "shortcuts"}
            onClick={() => setActiveSection("shortcuts")}
          />
          <SettingsNavItem
            icon={Palette}
            label="Appearance"
            isActive={activeSection === "appearance"}
            onClick={() => setActiveSection("appearance")}
          />
        </nav>
      </div>

      <div className="settings-content">
        <AnimatePresence mode="wait">
          {activeSection === "account" && (
            <AccountSection
              key="account"
              user={user}
              organization={organization}
              onLogout={handleLogout}
            />
          )}
          {activeSection === "privacy" && <PrivacySection key="privacy" />}
          {activeSection === "shortcuts" && <ShortcutsSection key="shortcuts" />}
          {activeSection === "appearance" && <AppearanceSection key="appearance" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface NavItemProps {
  icon: typeof User;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function SettingsNavItem({ icon: Icon, label, isActive, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      className={`settings-nav-item ${isActive ? "active" : ""}`}
      onClick={onClick}
    >
      <Icon size={18} />
      <span>{label}</span>
      {isActive && (
        <motion.div
          className="settings-nav-indicator"
          layoutId="settings-nav-indicator"
        />
      )}
    </button>
  );
}

interface AccountSectionProps {
  user: { email: string; name?: string | null } | null;
  organization: { id: string; name: string } | null;
  onLogout: () => void;
}

function AccountSection({ user, organization, onLogout }: AccountSectionProps) {
  return (
    <SectionWrapper title="Account">
      <div className="settings-card">
        <div className="settings-profile">
          <div className="settings-avatar">
            {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="settings-profile-info">
            <h3>{user?.name || "User"}</h3>
            <p>{user?.email || "No email"}</p>
          </div>
        </div>
      </div>

      {organization && (
        <div className="settings-card">
          <h4 className="settings-card-title">Organization</h4>
          <div className="settings-org-info">
            <span className="settings-org-name">{organization.name}</span>
            <span className="settings-org-slug">{organization.id}</span>
          </div>
        </div>
      )}

      <div className="settings-card settings-card-danger">
        <button type="button" className="settings-logout-btn" onClick={onLogout}>
          <LogOut size={18} />
          <span>Sign Out</span>
        </button>
      </div>
    </SectionWrapper>
  );
}

function PrivacySection() {
  const [screenshotEnabled, setScreenshotEnabled] = useState(true);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(true);
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);

  return (
    <SectionWrapper title="Privacy & Context">
      <p className="settings-section-description">
        Control what context Drovi can capture to enhance your experience.
      </p>

      <div className="settings-card">
        <h4 className="settings-card-title">Context Capture</h4>

        <ToggleSetting
          icon={Camera}
          label="Window Screenshots"
          description="Capture screenshots of active windows for visual context"
          enabled={screenshotEnabled}
          onChange={setScreenshotEnabled}
        />

        <ToggleSetting
          icon={Accessibility}
          label="Accessibility Access"
          description="Read selected text from applications"
          enabled={accessibilityEnabled}
          onChange={setAccessibilityEnabled}
        />

        <ToggleSetting
          icon={FileText}
          label="OCR Text Extraction"
          description="Extract text from screenshots using OCR"
          enabled={ocrEnabled}
          onChange={setOcrEnabled}
        />
      </div>

      <div className="settings-card">
        <h4 className="settings-card-title">Data Retention</h4>

        <div className="settings-retention">
          <div className="settings-retention-info">
            <Clock size={18} />
            <div>
              <span>Context Retention Period</span>
              <p>How long captured context is stored locally</p>
            </div>
          </div>
          <select
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="settings-select"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>

        <button type="button" className="settings-clear-btn">
          <Trash2 size={16} />
          <span>Clear Context Cache</span>
        </button>
      </div>
    </SectionWrapper>
  );
}

function ShortcutsSection() {
  return (
    <SectionWrapper title="Keyboard Shortcuts">
      <p className="settings-section-description">
        Drovi is designed for keyboard-first navigation. Learn these shortcuts to navigate like a pro.
      </p>

      <div className="settings-card">
        <div className="shortcuts-grid">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.description} className="shortcut-item">
              <div className="shortcut-keys">
                {shortcut.keys.map((key, i) => (
                  <span key={`${shortcut.description}-${key}-${i}`}>
                    <kbd className="kbd">{key}</kbd>
                    {i < shortcut.keys.length - 1 && <span className="shortcut-plus">+</span>}
                  </span>
                ))}
              </div>
              <span className="shortcut-description">{shortcut.description}</span>
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");

  return (
    <SectionWrapper title="Appearance">
      <div className="settings-card">
        <h4 className="settings-card-title">Theme</h4>
        <div className="theme-options">
          <ThemeOption
            label="Dark"
            value="dark"
            selected={theme === "dark"}
            onSelect={() => setTheme("dark")}
          />
          <ThemeOption
            label="Light"
            value="light"
            selected={theme === "light"}
            onSelect={() => setTheme("light")}
            disabled
          />
          <ThemeOption
            label="System"
            value="system"
            selected={theme === "system"}
            onSelect={() => setTheme("system")}
            disabled
          />
        </div>
        <p className="settings-hint">
          Light mode and system preference coming soon.
        </p>
      </div>
    </SectionWrapper>
  );
}

interface SectionWrapperProps {
  title: string;
  children: React.ReactNode;
}

function SectionWrapper({ title, children }: SectionWrapperProps) {
  return (
    <motion.div
      className="settings-section"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h3 className="settings-section-title">{title}</h3>
      {children}
    </motion.div>
  );
}

interface ToggleSettingProps {
  icon: typeof Camera;
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function ToggleSetting({ icon: Icon, label, description, enabled, onChange }: ToggleSettingProps) {
  return (
    <div className="toggle-setting">
      <div className="toggle-setting-info">
        <Icon size={18} className="toggle-setting-icon" />
        <div>
          <span className="toggle-setting-label">{label}</span>
          <p className="toggle-setting-description">{description}</p>
        </div>
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

interface ThemeOptionProps {
  label: string;
  value: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

function ThemeOption({ label, value, selected, onSelect, disabled }: ThemeOptionProps) {
  return (
    <button
      type="button"
      className={`theme-option ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
      onClick={onSelect}
      disabled={disabled}
    >
      <div className={`theme-preview theme-preview-${value}`} />
      <span>{label}</span>
      {selected && <Check size={16} className="theme-check" />}
    </button>
  );
}
