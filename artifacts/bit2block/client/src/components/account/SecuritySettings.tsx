import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionCard } from "./SectionCard";

/**
 * Security block: TOTP two-factor setup (primary) and the 6-digit security PIN
 * used by withdrawals (secondary). Both keep the existing API contracts.
 */
export function SecuritySettings({ user }: { user: any }) {
  const { toast } = useToast();
  const [show2FADialog, setShow2FADialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);

  // 2FA state
  const [twoFactorSetupData, setTwoFactorSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [twoFactorVerifyToken, setTwoFactorVerifyToken] = useState("");
  const [disable2FAInput, setDisable2FAInput] = useState("");

  // PIN state
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const { data: twoFactorStatus, refetch: refetch2FA } = useQuery<{ enabled: boolean; hasSecret: boolean }>({
    queryKey: ["/api/2fa/status"],
    enabled: !!user,
  });

  const generate2FAMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/2fa/generate");
      return res.json();
    },
    onSuccess: (data) => {
      setTwoFactorSetupData(data);
      setTwoFactorVerifyToken("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate 2FA", description: err.message, variant: "destructive" });
    },
  });

  const enable2FAMutation = useMutation({
    mutationFn: async (data: { secret: string; token: string }) => {
      const res = await apiRequest("POST", "/api/2fa/enable", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "2FA Enabled", description: "Two-Factor Authentication is now active on your account." });
      refetch2FA();
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setShow2FADialog(false);
      setTwoFactorSetupData(null);
      setTwoFactorVerifyToken("");
    },
    onError: (err: any) => {
      toast({ title: "Activation Failed", description: err.message, variant: "destructive" });
    },
  });

  const disable2FAMutation = useMutation({
    mutationFn: async (data: { token?: string; pin?: string }) => {
      const res = await apiRequest("POST", "/api/2fa/disable", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "2FA Disabled", description: "Two-Factor Authentication has been disabled." });
      refetch2FA();
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setShow2FADialog(false);
      setDisable2FAInput("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to Disable", description: err.message, variant: "destructive" });
    },
  });

  const changePinMutation = useMutation({
    mutationFn: async (data: { currentPin: string; newPin: string }) => {
      const res = await apiRequest("POST", "/api/change-pin", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "PIN Updated", description: "Your security PIN has been changed" });
      setShowPinDialog(false);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    },
    onError: (error: Error) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleOpen2FA = () => {
    setShow2FADialog(true);
    if (!twoFactorStatus?.enabled) {
      generate2FAMutation.mutate();
    }
  };

  const handlePinChange = () => {
    if (!currentPin || !newPin || !confirmPin) {
      toast({ title: "Invalid Input", description: "Please fill all fields", variant: "destructive" });
      return;
    }
    if (newPin !== confirmPin) {
      toast({ title: "PIN Mismatch", description: "New PIN and confirmation don't match", variant: "destructive" });
      return;
    }
    if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
      toast({ title: "Invalid PIN", description: "PIN must be exactly 6 digits", variant: "destructive" });
      return;
    }
    changePinMutation.mutate({ currentPin, newPin });
  };

  const twoFactorEnabled = Boolean(twoFactorStatus?.enabled ?? user?.twoFactorEnabled);
  const pinSet = Boolean(user?.securityPin);

  return (
    <SectionCard
      icon={ShieldCheck}
      label="Protection"
      title="Security"
      description="Second-factor protection for logins and payouts"
    >
      <div className="divide-y divide-white/5">
        <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
          <div className="flex min-w-0 items-start gap-2.5">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">Two-Factor Authentication</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                {twoFactorEnabled ? "Active — codes required at login and withdrawal." : "Not enabled — protect your account with an authenticator app."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                twoFactorEnabled ? "border-primary/30 bg-primary/5 text-primary" : "border-white/10 text-zinc-500"
              }`}
              data-testid="status-2fa"
            >
              {twoFactorEnabled ? "Active" : "Off"}
            </span>
            <Button
              size="sm"
              variant={twoFactorEnabled ? "outline" : "default"}
              className={`h-7 px-2.5 text-[11px] ${twoFactorEnabled ? "border-white/15 text-zinc-300 hover:border-primary/40" : ""}`}
              onClick={handleOpen2FA}
              data-testid="button-manage-2fa"
            >
              {twoFactorEnabled ? "Manage" : "Set up"}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 py-3 last:pb-0">
          <div className="flex min-w-0 items-start gap-2.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">Security PIN</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                {pinSet ? "Set — required on every withdrawal." : "Not set — required before your first withdrawal."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                pinSet ? "border-primary/30 bg-primary/5 text-primary" : "border-white/10 text-zinc-500"
              }`}
            >
              {pinSet ? "Set" : "None"}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-white/15 px-2.5 text-[11px] text-zinc-300 hover:border-primary/40"
              onClick={() => setShowPinDialog(true)}
              data-testid="button-change-pin"
            >
              Change
            </Button>
          </div>
        </div>
      </div>

      {/* 2FA dialog */}
      <Dialog open={show2FADialog} onOpenChange={setShow2FADialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-black">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-base text-white">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {twoFactorEnabled ? "Two-Factor Authentication" : "Set Up Two-Factor Authentication"}
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              {twoFactorEnabled
                ? "Enter a code from your authenticator app to turn 2FA off."
                : "Scan the QR code with Google Authenticator or Authy, then confirm the 6-digit code."}
            </DialogDescription>
          </DialogHeader>

          {twoFactorEnabled ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-[11px] text-primary/90">
                2FA is currently active for logins and withdrawals.
              </div>
              <div>
                <Label htmlFor="disable-2fa-token" className="text-xs text-zinc-300">
                  Enter 2FA code or 6-digit Security PIN to disable
                </Label>
                <Input
                  id="disable-2fa-token"
                  type="text"
                  value={disable2FAInput}
                  onChange={(e) => setDisable2FAInput(e.target.value.replace(/\D/g, ""))}
                  placeholder="6-digit code or PIN"
                  maxLength={6}
                  className="mt-1 border-white/10 bg-black text-center font-mono text-lg tracking-widest text-white"
                />
              </div>
              <Button
                onClick={() => {
                  if (disable2FAInput.length !== 6) {
                    toast({ title: "Invalid Input", description: "Enter 6-digit code or PIN", variant: "destructive" });
                    return;
                  }
                  disable2FAMutation.mutate({ token: disable2FAInput, pin: disable2FAInput });
                }}
                disabled={disable2FAMutation.isPending || disable2FAInput.length !== 6}
                variant="outline"
                className="w-full border-white/15 text-zinc-200 hover:border-primary/40"
                data-testid="button-disable-2fa"
              >
                {disable2FAMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Disabling…
                  </>
                ) : (
                  "Disable 2FA"
                )}
              </Button>
            </div>
          ) : generate2FAMutation.isPending || !twoFactorSetupData ? (
            <div className="flex flex-col items-center justify-center space-y-2 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs text-zinc-500">Generating secret key…</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="mx-auto w-fit rounded-xl bg-white p-4">
                <QRCodeSVG value={twoFactorSetupData.uri} size={160} level="M" includeMargin={false} />
              </div>

              <div>
                <Label className="text-xs text-zinc-500">Can't scan? Enter manually:</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    readOnly
                    value={twoFactorSetupData.secret}
                    className="border-white/10 bg-black font-mono text-xs tracking-wider text-primary"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-white/15 hover:border-primary/40"
                    onClick={() => {
                      navigator.clipboard.writeText(twoFactorSetupData.secret);
                      toast({ title: "Copied!", description: "Secret key copied to clipboard" });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="verify-2fa-token" className="text-xs text-zinc-300">
                  Enter the 6-digit code from your app:
                </Label>
                <Input
                  id="verify-2fa-token"
                  type="text"
                  inputMode="numeric"
                  value={twoFactorVerifyToken}
                  onChange={(e) => setTwoFactorVerifyToken(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  maxLength={6}
                  className="mt-1 border-white/10 bg-black text-center font-mono text-lg tracking-widest text-white"
                />
              </div>

              <Button
                onClick={() => {
                  if (twoFactorVerifyToken.length !== 6) {
                    toast({ title: "Invalid Code", description: "Enter 6-digit verification code", variant: "destructive" });
                    return;
                  }
                  enable2FAMutation.mutate({ secret: twoFactorSetupData.secret, token: twoFactorVerifyToken });
                }}
                disabled={enable2FAMutation.isPending || twoFactorVerifyToken.length !== 6}
                className="w-full font-bold"
                data-testid="button-enable-2fa"
              >
                {enable2FAMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Activate 2FA
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PIN dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent className="border-white/10 bg-black">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-base text-white">
              <Lock className="h-4 w-4 text-primary" />
              Security PIN
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              Six digits, required on every withdrawal. Never share it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="pin-current" className="text-xs text-zinc-300">
                Current PIN
              </Label>
              <Input
                id="pin-current"
                type="password"
                inputMode="numeric"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
                maxLength={6}
                placeholder="••••••"
                className="mt-1 border-white/10 bg-black text-center font-mono text-lg tracking-widest text-white"
              />
            </div>
            <div>
              <Label htmlFor="pin-new" className="text-xs text-zinc-300">
                New PIN
              </Label>
              <Input
                id="pin-new"
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                maxLength={6}
                placeholder="••••••"
                className="mt-1 border-white/10 bg-black text-center font-mono text-lg tracking-widest text-white"
              />
            </div>
            <div>
              <Label htmlFor="pin-confirm" className="text-xs text-zinc-300">
                Confirm New PIN
              </Label>
              <Input
                id="pin-confirm"
                type="password"
                inputMode="numeric"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                maxLength={6}
                placeholder="••••••"
                className="mt-1 border-white/10 bg-black text-center font-mono text-lg tracking-widest text-white"
              />
            </div>
            <Button
              onClick={handlePinChange}
              disabled={changePinMutation.isPending || currentPin.length !== 6 || newPin.length !== 6 || confirmPin.length !== 6}
              className="w-full font-bold"
              data-testid="button-save-pin"
            >
              {changePinMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating…
                </>
              ) : (
                "Update PIN"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
