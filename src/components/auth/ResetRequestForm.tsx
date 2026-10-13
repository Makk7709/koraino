import { ArrowLeft, MailCheck, Send } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import { InlineError, Notice, fieldClass } from "@/components/veille/kit";
import { requestPasswordReset } from "@/lib/auth/session";
import { emailProblem, fieldAria } from "@/lib/auth/validation";
import { cn } from "@/lib/utils";
import { AuthField } from "./AuthField";

/** « Mot de passe oublié » : envoi d'un lien de réinitialisation par e-mail. */
export function ResetRequestForm({
  email,
  onEmailChange,
  onBack,
}: {
  email: string;
  onEmailChange: (email: string) => void;
  onBack: () => void;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const problem = submitted ? emailProblem(email) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (emailProblem(email)) return emailRef.current?.focus();
    setError(null);
    setPending(true);
    const target = email.trim();
    const result = await requestPasswordReset(target);
    setPending(false);
    if (result.ok) setSentTo(target);
    else setError(result.message);
  };

  if (sentTo) {
    return (
      <div className="space-y-4">
        <Notice tone="green" icon={MailCheck} title="Vérifiez votre boîte de réception">
          Si un compte KORA existe pour <strong className="text-kora-ink">{sentTo}</strong>, un
          e-mail contenant un lien pour choisir un nouveau mot de passe vient d&apos;être envoyé. Ce
          lien n&apos;est valable qu&apos;une fois et pour une durée limitée.
        </Notice>
        <GhostButton onClick={onBack} className="w-full" autoFocus>
          <ArrowLeft className="size-4" />
          Retour à la connexion
        </GhostButton>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-4" aria-busy={pending}>
      {error && <InlineError title="Envoi impossible">{error}</InlineError>}
      <AuthField
        id="reset-email"
        label="Adresse e-mail"
        error={problem}
        hint="Saisissez l'adresse de votre compte KORA : vous recevrez un lien pour définir un nouveau mot de passe."
      >
        <Input
          ref={emailRef}
          id="reset-email"
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
          className={cn(fieldClass, "h-10", problem && "border-kora-rose/60")}
          {...fieldAria("reset-email", problem, true)}
        />
      </AuthField>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <PrimaryButton type="submit" disabled={pending} className="h-10 flex-1">
          <Send className="size-4" />
          {pending ? "Envoi…" : "Envoyer le lien"}
        </PrimaryButton>
        <GhostButton onClick={onBack} className="h-10">
          <ArrowLeft className="size-4" />
          Retour
        </GhostButton>
      </div>
    </form>
  );
}
