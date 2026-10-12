import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { ChevronRight, Copy, Loader2, ShieldCheck, Smartphone } from "lucide-react";

interface TwoFactorStatus {
  enabled: boolean;
  hasSecret: boolean;
}

export function TwoFactorSettings() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [verifyToken, setVerifyToken] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const { data: status, refetch } = useQuery<TwoFactorStatus>({
    queryKey: ["/api/2fa/status"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/2fa/generate");
      return res.json();
    },
    onSuccess: (data) => {
      setSetupData(data);
      setVerifyToken("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate 2FA", description: err.message, variant: "destructive" });
    },
  });

  const enableMutation = useMutation({
    mutationFn: async (data: { secret: string; token: string }) => {
      const res = await apiRequest("POST", "/api/2fa/enable", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "2FA Enabled", description: "Two-factor authentication is now active." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Activation Failed", description: err.message, variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (data: { token: string }) => {
      const res = await apiRequest("POST", "/api/2fa/disable", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "2FA Disabled", description: "Two-factor authentication has been turned off." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to Disable", description: err.message, variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setOpen(false);
    setSetupData(null);
    setVerifyToken("");
    setDisableCode("");
  };

  const handleOpen = () => {
    setOpen(true);
    if (!status?.enabled && !setupData) {
      generateMutation.mutate();
    }
  };

  const isEnabled = Boolean(status?.enabled);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 text-left transition-colors hover:border-primary/40"
        data-testid="button-manage-2fa"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Smartphone className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Two-Factor Authentication</p>
            <p className="text-[11px] text-zinc-500">
              {isEnabled ? "TOTP app active on this account" : "Add a TOTP app code to sign in"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] ${
              isEnabled
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-zinc-700 text-zinc-400"
            }`}
          >
            {isEnabled ? "ON" : "OFF"}
          </Badge>
          <ChevronRight className="h-4 w-4 text-zinc-600" />
        </div>
      </button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
        <DialogContent className="border border-zinc-800 bg-zinc-950 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Two-Factor Authentication
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              {isEnabled
                ? "Enter a current code from your authenticator app to turn 2FA off."
                : "Scan the QR code with Google Authenticator or any TOTP app."}
            </DialogDescription>
          </DialogHeader>

          {isEnabled ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-[11px] leading-relaxed text-emerald-300">
                Two-factor authentication protects sign-in and withdrawals. Disabling it lowers your account
                security.
              </div>
              <div>
                <Label htmlFor="disable-2fa-code" className="text-xs text-zinc-300">
                  Authenticator code
                </Label>
                <Input
                  id="disable-2fa-code"
                  type="text"
                  inputMode="numeric"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  maxLength={6}
                  className="mt-1 border-zinc-700 bg-black text-center font-mono text-lg tracking-widest text-white"
                />
              </div>
              <Button
                onClick={() => disableMutation.mutate({ token: disableCode })}
                disabled={disableMutation.isPending || disableCode.length !== 6}
                variant="destructive"
                className="w-full"
                data-testid="button-disable-2fa"
              >
                {disableMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Disabling...
                  </>
                ) : (
                  "Disable 2FA"
                )}
              </Button>
            </div>
          ) : generateMutation.isPending || !setupData ? (
            <div className="flex flex-col items-center justify-center space-y-2 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs text-zinc-400">Generating secret key...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="mx-auto w-fit rounded-xl bg-white p-4">
                <QRCodeSVG value={setupData.uri} size={160} level="M" includeMargin={false} />
              </div>

              <div>
                <Label className="text-xs text-zinc-400">Can&apos;t scan? Enter this key manually:</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    readOnly
                    value={setupData.secret}
                    className="border-zinc-800 bg-black font-mono text-xs tracking-wider text-primary"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-zinc-700 hover:bg-zinc-800"
                    onClick={() => {
                      navigator.clipboard.writeText(setupData.secret);
                      toast({ title: "Copied!", description: "Secret key copied to clipboard" });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="verify-2fa-token" className="text-xs text-zinc-300">
                  Enter the 6-digit code from your app
                </Label>
                <Input
                  id="verify-2fa-token"
                  type="text"
                  inputMode="numeric"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  maxLength={6}
                  className="mt-1 border-zinc-700 bg-black text-center font-mono text-lg tracking-widest text-white"
                />
              </div>

              <Button
                onClick={() => enableMutation.mutate({ secret: setupData.secret, token: verifyToken })}
                disabled={enableMutation.isPending || verifyToken.length !== 6}
                className="w-full font-bold"
                data-testid="button-enable-2fa"
              >
                {enableMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying & activating...
                  </>
                ) : (
                  "Activate 2FA"
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
