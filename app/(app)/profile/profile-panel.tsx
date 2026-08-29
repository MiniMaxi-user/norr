"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  FormSection,
  Heading,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  Stack,
  Text,
  useEscapeToClose,
  useTheme,
} from "@yourorg/ui";
import { Globe, Lock, Moon, Sun, UserRound } from "@yourorg/ui/icons";
import { AvatarUploader } from "./avatar-uploader";
import { updatePassword, updateProfile } from "./actions";
import { LOCALES, type Locale } from "@/lib/profile/locale";

/**
 * Personal profile management (issue #49) — a slide-over panel
 * (`Dialog size="panel"`), the same pattern `NewClientPanel`/
 * `EditClientPanel` use, per an explicit product-owner-confirmed override of
 * docs/ARCHITECTURE.md's "top-level entities get a real page" default: this
 * isn't a top-level list-of-records module, it's a singleton per-user
 * settings surface, closer in spirit to the "Instellingen"/"Profiel" items
 * already in `components/shell/user-menu.tsx`'s dropdown. Opened from
 * `UserMenu` AND from the real `/profile` route (`app/(app)/profile/page.tsx`,
 * pre-opened, for deep-linking) — both render this exact component.
 *
 * Unlike `EditClientPanel`, this panel bundles several genuinely independent
 * operations (photo, name+language, password) rather than one record's
 * single update — so, deliberately, there is no single panel-wide `<form>`/
 * "Save" pair in `Dialog.Footer`. Each concern owns its own small `<form>`
 * (or, for the avatar, its own buttons — see `AvatarUploader`) and its own
 * inline success/error feedback, and stays open after a successful save so
 * the user can keep adjusting other settings in the same visit. The footer
 * is just a "Close" button. Theme has no save step at all: `@yourorg/ui`'s
 * `useTheme()` already persists client-side (see `ThemeToggle`), so
 * flipping it here takes effect immediately, same as the topbar toggle.
 */
export function ProfilePanel({
  open,
  onOpenChange,
  email,
  fullName,
  avatarUrl,
  locale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  // Local echo of the avatar so `AvatarUploader`'s own Avatar preview (and
  // the "Change photo"/"Remove" labels, which depend on whether a photo
  // exists) update the instant an upload/remove completes, without waiting
  // on `router.refresh()` to re-resolve the session server-side. The topbar
  // `UserMenu`'s own `Avatar` DOES wait for that refresh (see the
  // `onAvatarChange` callback passed to `AvatarUploader` below) — this
  // `localAvatarUrl` state is purely this panel's own instant preview.
  const [localAvatarUrl, setLocalAvatarUrl] = useState(avatarUrl);
  useEffect(() => setLocalAvatarUrl(avatarUrl), [avatarUrl]);

  const displayName = fullName?.trim() || email;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="panel">
      <Dialog.Header>
        <Heading level={3}>Profile</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          <FormSection title="Photo" icon={<UserRound />}>
            <AvatarUploader
              name={displayName}
              avatarUrl={localAvatarUrl}
              onAvatarChange={(next) => {
                setLocalAvatarUrl(next);
                // Re-resolves `getCurrentSession()` server-side so the
                // topbar's own `UserMenu` avatar (a separate render of the
                // same photo, fed from the session — see
                // `components/shell/topbar.tsx`) picks up the change too,
                // same `router.refresh()`-after-mutation pattern
                // `EditClientPanel` uses.
                router.refresh();
              }}
            />
          </FormSection>

          <ProfileDetailsSection fullName={fullName} locale={locale} onSaved={() => router.refresh()} />

          <PasswordSection />

          <AppearanceSection />
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

interface ProfileFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialProfileState: ProfileFormState = {};

function ProfileDetailsSection({
  fullName,
  locale,
  onSaved,
}: {
  fullName: string | null;
  locale: Locale;
  onSaved: () => void;
}) {
  async function action(_prevState: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
    const input = Object.fromEntries(formData.entries());
    const result = await updateProfile(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialProfileState);

  useEffect(() => {
    if (state.success) onSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <FormSection title="Name & language" icon={<Globe />}>
      <form action={formAction}>
        <Stack gap="sm">
          {state.error && <Text tone="danger">{state.error}</Text>}
          {state.success && <Text tone="success">Saved.</Text>}

          <Stack gap="xs">
            <Label htmlFor="profile-full-name">Name</Label>
            <Input id="profile-full-name" name="fullName" defaultValue={fullName ?? ""} required maxLength={200} />
            {state.fieldErrors?.fullName?.map((message) => (
              <Text key={message} tone="danger">
                {message}
              </Text>
            ))}
          </Stack>

          <Stack gap="xs">
            <Label htmlFor="profile-locale">Language</Label>
            {/* Stored preference only — there is no i18n/translation system
                in this app yet (login/topbar are hardcoded Dutch, other
                modules like Clients are hardcoded English). Changing this
                does not currently translate anything; it just remembers the
                choice for when real i18n is wired up. See
                `lib/profile/locale.ts`. */}
            <Select id="profile-locale" name="locale" defaultValue={locale}>
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {value === "nl" ? "Nederlands" : "English"}
                </option>
              ))}
            </Select>
            {state.fieldErrors?.locale?.map((message) => (
              <Text key={message} tone="danger">
                {message}
              </Text>
            ))}
          </Stack>

          <SaveButton label="Save changes" pendingLabel="Saving…" />
        </Stack>
      </form>
    </FormSection>
  );
}

interface PasswordFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialPasswordState: PasswordFormState = {};

function PasswordSection() {
  async function action(_prevState: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      return { error: "Passwords do not match.", fieldErrors: { confirmPassword: ["Passwords do not match."] } };
    }
    const result = await updatePassword({ newPassword });
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialPasswordState);

  return (
    <FormSection title="Password" icon={<Lock />}>
      <form
        action={formAction}
        onSubmit={(event) => {
          // Clear both fields on submit (success or failure) rather than
          // echoing a submitted password back into the inputs — unlike every
          // other form in this app, a password is never something to
          // re-display after a failed attempt.
          const form = event.currentTarget;
          requestAnimationFrame(() => form.reset());
        }}
      >
        <Stack gap="sm">
          {state.error && <Text tone="danger">{state.error}</Text>}
          {state.success && <Text tone="success">Password changed.</Text>}

          <Stack gap="xs">
            <Label htmlFor="profile-new-password">New password</Label>
            <Input id="profile-new-password" name="newPassword" type="password" required minLength={8} />
            {state.fieldErrors?.newPassword?.map((message) => (
              <Text key={message} tone="danger">
                {message}
              </Text>
            ))}
          </Stack>

          <Stack gap="xs">
            <Label htmlFor="profile-confirm-password">Confirm new password</Label>
            <Input id="profile-confirm-password" name="confirmPassword" type="password" required minLength={8} />
            {state.fieldErrors?.confirmPassword?.map((message) => (
              <Text key={message} tone="danger">
                {message}
              </Text>
            ))}
          </Stack>

          <SaveButton label="Change password" pendingLabel="Changing…" />
        </Stack>
      </form>
    </FormSection>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <FormSection title="Appearance" icon={isDark ? <Moon /> : <Sun />}>
      <RadioGroup>
        <Stack gap="xs">
          <Label>
            <RadioGroupItem name="theme" checked={!isDark} onChange={() => setTheme("light")} /> Light
          </Label>
          <Label>
            <RadioGroupItem name="theme" checked={isDark} onChange={() => setTheme("dark")} /> Dark
          </Label>
        </Stack>
      </RadioGroup>
    </FormSection>
  );
}

function SaveButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
