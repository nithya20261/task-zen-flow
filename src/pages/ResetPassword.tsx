import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

const passwordSchema = z.object({ password: z.string().min(8, "Password must be at least 8 characters.") });

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = passwordSchema.safeParse({ password });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message);
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setIsSaving(false);

    if (error) toast.error(error.message);
    else {
      toast.success("Password updated. You can continue planning.");
      navigate("/");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-app-gradient px-4 py-6">
      <form onSubmit={handleSubmit} className="glass-panel w-full max-w-md rounded-xl border border-border p-6 shadow-panel">
        <p className="font-bold text-primary">Secure reset</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Create a new password</h1>
        <div className="mt-6 space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimum 8 characters" />
        </div>
        <Button className="mt-5 w-full" variant="hero" disabled={isSaving}>Update password</Button>
        <Button asChild className="mt-3 w-full" variant="ghost"><Link to="/">Back to login</Link></Button>
      </form>
    </main>
  );
}
