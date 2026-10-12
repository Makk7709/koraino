import { KeyRound } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { PrimaryButton } from "@/components/kora/primitives";
import { InlineError, fieldClass } from "@/components/veille/kit";
import { updatePassword } from "@/lib/auth/session";
import { MIN_PASSWORD_LENGTH, fieldAria, newPasswordProblem } from "@/lib/auth/validation";
import { cn } from "@/lib/utils";
import { AuthField } from "./AuthField";
import { PasswordInput } from "./PasswordInput";

export function NewPasswordForm({
  email,
  submitLabel,
  onDone,
}: {
  /** Compte concerné (aide les gestionnaires de mots de passe). */
  email: string;
  submitLabel: string;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const errors = {
    password: newPasswordProblem(password),
    confirm: confirm === password ? null : "Les deux mots de passe ne correspondent pas.",
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (errors.password) return passwordRef.current?.focus();
    if (errors.confirm) return confirmRef.current?.focus();
    setError(null);
    setPending(true);
    const result = await updatePassword(password);
    setPending(false);
    if (result.ok) onDone();
    else {
      setError(result.message);
      passwordRef.current?.focus();
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-4" aria-busy={pending}>
      {error && <InlineError title="Mot de passe non enregistré">{error}</InlineError>}

      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <p className="text-[12px] text-kora-ink-soft">
        Compte : <span className="font-semibold text-kora-ink">{email}</span>
      </p>

      <AuthField
        id="new-password"
        label="Nouveau mot de passe"
        error={show("password")}
        hint={`${MIN_PASSWORD_LENGTH} caractères minimum. Évitez un mot de passe déjà utilisé ailleurs.`}
      >
        <PasswordInput
          ref={passwordRef}
          id="new-password"
          name="new-password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={cn(fieldClass, "h-10", show("password") && "border-kora-rose/60")}
          {...fieldAria("new-password", show("password"), true)}
        />
      </AuthField>

      <AuthField id="confirm-password" label="Confirmation" error={show("confirm")}>
        <PasswordInput
          ref={confirmRef}
          id="confirm-password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={cn(fieldClass, "h-10", show("confirm") && "border-kora-rose/60")}
          {...fieldAria("confirm-password", show("confirm"))}
        />
      </AuthField>

      <PrimaryButton type="submit" disabled={pending} className="h-10 w-full">
        <KeyRound className="size-4" />
        {pending ? "Enregistrement…" : submitLabel}
      </PrimaryButton>
    </form>
  );
}
