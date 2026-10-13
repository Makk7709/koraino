import { LogIn } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { PrimaryButton } from "@/components/kora/primitives";
import { InlineError, fieldClass } from "@/components/veille/kit";
import { dismissAuthNotice, signInWithPassword } from "@/lib/auth/session";
import { emailProblem, fieldAria } from "@/lib/auth/validation";
import { cn } from "@/lib/utils";
import { AuthField } from "./AuthField";
import { PasswordInput } from "./PasswordInput";

export function LoginForm({
  email,
  onEmailChange,
  onForgot,
  onPendingChange,
}: {
  email: string;
  onEmailChange: (email: string) => void;
  onForgot: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const errors = {
    email: emailProblem(email),
    password: password ? null : "Saisissez votre mot de passe.",
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();
    setError(null);
    dismissAuthNotice();
    setPending(true);
    onPendingChange(true);
    const result = await signInWithPassword(email.trim(), password);
    setPending(false);
    onPendingChange(false);
    if (!result.ok) {
      setError(result.message);
      passwordRef.current?.select();
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-4" aria-busy={pending}>
      {error && <InlineError title="Connexion impossible">{error}</InlineError>}

      <AuthField id="login-email" label="Adresse e-mail" error={show("email")}>
        <Input
          ref={emailRef}
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          className={cn(fieldClass, "h-10", show("email") && "border-kora-rose/60")}
          {...fieldAria("login-email", show("email"))}
        />
      </AuthField>

      <AuthField
        id="login-password"
        label="Mot de passe"
        error={show("password")}
        action={
          <button
            type="button"
            onClick={onForgot}
            className="rounded text-[12px] font-medium text-kora-teal transition hover:text-kora-teal-dark hover:underline focus-visible:ring-2 focus-visible:ring-kora-teal/40 focus-visible:outline-none"
          >
            Mot de passe oublié ?
          </button>
        }
      >
        <PasswordInput
          ref={passwordRef}
          id="login-password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={cn(fieldClass, "h-10", show("password") && "border-kora-rose/60")}
          {...fieldAria("login-password", show("password"))}
        />
      </AuthField>

      <PrimaryButton type="submit" disabled={pending} className="h-10 w-full">
        <LogIn className="size-4" />
        {pending ? "Connexion…" : "Se connecter"}
      </PrimaryButton>
    </form>
  );
}
