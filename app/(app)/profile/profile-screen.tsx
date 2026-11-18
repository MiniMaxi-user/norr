"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebButton, WebCard, WebCardStack, WebField, WebHint, WebInput, WebSettingsMain, WebSettingsPage } from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  KeyValueCard,
  PageHeader,
  useEditMode,
  type EditSchema,
  type SaveResult,
} from "@yourorg/ui/web-client";
import { LOCALES, type Locale } from "@/lib/profile/locale";
import { ProfileAvatarSlot } from "./avatar-uploader";
import { updatePassword, updateProfile } from "./actions";

export interface ProfileScreenProps {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  locale: Locale;
}

type ProfileDraft = {
  fullName: string;
  locale: string;
};

const LOCALE_OPTIONS = LOCALES.map((value) => ({ value, label: value === "nl" ? "Nederlands" : "English" }));
const PASSWORD_MIN_LENGTH = 8;

/**
 * `/profile` on the web design system (issue #222): the personal settings of the
 * signed-in user, read like a record's Overview. One "Details" card (name,
 * language, and the sign-in email as a grey derived value) with ONE Edit button
 * in the header, `useEditMode` around the existing `updateProfile` action
 * (Cancel + gold Save, Esc, Ctrl/Cmd+S, "Saved" toast). The photo is the header
 * slot (upload/change/remove while editing, persists at once); the password has
 * its own small card with its own button, because it is a separate credential
 * operation, not part of the profile record. Replaces the old slide-over panel.
 *
 * The language is a stored preference only: there is no i18n system, so
 * changing it does not translate anything (see `lib/profile/locale.ts`).
 */
export function ProfileScreen({ email, fullName, avatarUrl, locale }: ProfileScreenProps) {
  const router = useRouter();
  const [localAvatarUrl, setLocalAvatarUrl] = useState(avatarUrl);
  useEffect(() => setLocalAvatarUrl(avatarUrl), [avatarUrl]);

  const record = useMemo<ProfileDraft>(() => ({ fullName: fullName ?? "", locale }), [fullName, locale]);
  const schema = useMemo<EditSchema<ProfileDraft>>(
    () => ({
      fullName: {
        label: "Name",
        required: true,
        validate: (value) => {
          const length = value.trim().length;
          if (length === 0) return "Enter your name";
          return length > 200 ? `Name is ${length} characters, the maximum is 200. Remove ${length - 200}` : null;
        },
      },
      locale: {
        label: "Language",
        required: true,
        format: (value) => LOCALE_OPTIONS.find((option) => option.value === value)?.label ?? "",
        validate: (value) => (LOCALES.includes(value as Locale) ? null : "Choose a language"),
      },
    }),
    [],
  );

  const edit = useEditMode<ProfileDraft>({
    record,
    schema,
    canEdit: true,
    idPrefix: "profile",
    firstFieldKey: "fullName",
    navigate: (href) => router.push(href),
    onSave: async (draft): Promise<SaveResult<ProfileDraft>> => {
      const result = await updateProfile({ fullName: draft.fullName, locale: draft.locale });
      if (result.error || !result.data) {
        const fieldErrors: Partial<Record<"fullName" | "locale", string>> = {};
        if (result.fieldErrors?.fullName?.[0]) fieldErrors.fullName = result.fieldErrors.fullName[0];
        if (result.fieldErrors?.locale?.[0]) fieldErrors.locale = result.fieldErrors.locale[0];
        return { ok: false, error: result.error ?? "Could not save your profile", fieldErrors };
      }
      return { ok: true };
    },
    onSaved: () => {
      toast({ title: "Saved", tone: "success", duration: 3000 });
      // Re-resolves the session so the topbar avatar menu shows the new name.
      router.refresh();
    },
  });

  const saved = edit.record;
  const displayName = saved.fullName.trim() || email;

  return (
    <WebSettingsPage>
      <PageHeader
        breadcrumb={[{ label: "Profile" }]}
        title="Profile"
        logo={
          <ProfileAvatarSlot
            name={displayName}
            avatarUrl={localAvatarUrl}
            editable={edit.isEditing}
            onAvatarChange={(next) => {
              setLocalAvatarUrl(next);
              // The topbar's avatar is a separate render of the same photo, fed
              // from the session.
              router.refresh();
            }}
          />
        }
        badges={[{ label: email, variant: "mono" }]}
        mode={edit.mode}
        actions={{
          canEdit: true,
          onEdit: edit.startEdit,
          onSave: () => void edit.save(),
          onCancel: edit.requestCancel,
          saving: edit.saving,
          saveLabel: "Save",
        }}
        editStatus={edit.status}
      />
      <WebSettingsMain>
        <WebCardStack>
          <KeyValueCard
            title="Details"
            edit={edit}
            fields={[
              { key: "fullName", label: "Name", read: saved.fullName, maxLength: 200, autoComplete: "name" },
              {
                key: "locale",
                label: "Language",
                kind: "select",
                read: LOCALE_OPTIONS.find((option) => option.value === saved.locale)?.label ?? "",
                options: LOCALE_OPTIONS,
              },
              { key: "email", label: "Email", kind: "derived", read: email, note: "You sign in with this address" },
            ]}
          />
          <PasswordCard />
          <WebHint>
            Change your photo from the picture next to the title while editing; it is saved as soon as you confirm the
            crop. The language is remembered for later, nothing is translated yet.
          </WebHint>
        </WebCardStack>
      </WebSettingsMain>
      <EditDiscardDialog confirm={edit.confirm} />
    </WebSettingsPage>
  );
}

/** Separate credential operation with its own button — never part of the
 * profile's Edit / Save. Fields are cleared after every attempt: a password is
 * not something to echo back. */
function PasswordCard() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{ newPassword?: string; confirmPassword?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();

  function submit() {
    const next: typeof errors = {};
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      next.newPassword = `Password must be at least ${PASSWORD_MIN_LENGTH} characters. Add ${PASSWORD_MIN_LENGTH - newPassword.length} more`;
    }
    if (confirmPassword !== newPassword) next.confirmPassword = "Passwords do not match. Type the same password again";
    setErrors(next);
    if (next.newPassword || next.confirmPassword) return;

    startTransition(async () => {
      const result = await updatePassword({ newPassword });
      setNewPassword("");
      setConfirmPassword("");
      if (result.error || !result.data) {
        setErrors({
          newPassword: result.fieldErrors?.newPassword?.[0],
          form: result.fieldErrors?.newPassword?.[0] ? undefined : (result.error ?? "Could not change the password. Try again."),
        });
        return;
      }
      setErrors({});
      toast({ title: "Password changed", tone: "success", duration: 3000 });
    });
  }

  return (
    <WebCard title="Password">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        <WebField
          label="New password"
          htmlFor="profile-new-password"
          error={errors.newPassword}
          messageId="profile-new-password-message"
        >
          <WebInput
            id="profile-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.newPassword ? true : undefined}
            aria-describedby={errors.newPassword ? "profile-new-password-message" : undefined}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </WebField>
        <WebField
          label="Confirm new password"
          htmlFor="profile-confirm-password"
          error={errors.confirmPassword}
          messageId="profile-confirm-password-message"
        >
          <WebInput
            id="profile-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={errors.confirmPassword ? "profile-confirm-password-message" : undefined}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </WebField>
        {errors.form ? (
          <p className="web-dialog-error" role="alert">
            <span className="web-error-mark" aria-hidden="true">
              !
            </span>
            {errors.form}
          </p>
        ) : null}
        <div className="web-card-text">
          <WebButton type="submit" loading={pending}>
            {pending ? "Changing…" : "Change password"}
          </WebButton>
        </div>
      </form>
    </WebCard>
  );
}
