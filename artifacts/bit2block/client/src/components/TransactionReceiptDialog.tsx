import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, Loader2, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface ReceiptTransaction {
  id: string;
  displayType?: string;
  displayAmount?: string;
  amount?: string;
  currency?: string;
  status?: string;
  network?: string;
  address?: string;
  txHash?: string;
  createdAt?: string;
}

interface TransactionReceiptDialogProps {
  transaction: ReceiptTransaction | null;
  onClose: () => void;
}

const formatUtcDateTime = (dateStr?: string) => {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
};

const getStatusLabel = (status?: string) => {
  if (status === "approved" || status === "completed") return "Completed";
  if (status === "pending") return "Pending";
  if (status === "rejected") return "Rejected";
  return status || "—";
};

const getStatusStyles = (status?: string) => {
  switch (status) {
    case "approved":
    case "completed":
      return "bg-green-500/20 text-green-500 border-green-500/50";
    case "pending":
      return "bg-yellow-500/20 text-yellow-500 border-yellow-500/50";
    case "rejected":
      return "bg-red-500/20 text-red-500 border-red-500/50";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/50";
  }
};

export function TransactionReceiptDialog({ transaction, onClose }: TransactionReceiptDialogProps) {
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyValue = async (value: string, field: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      toast({ title: "Copied!", description: `${label} copied to clipboard`, duration: 2000 });
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive", duration: 2000 });
    }
  };

  if (!transaction) return null;

  const isWithdrawal = transaction.displayType === "Withdraw";
  const currency = transaction.currency || (isWithdrawal ? "USDT" : "");
  const amount = transaction.displayAmount
    || (transaction.amount !== undefined ? String(transaction.amount) : "0");
  const isPending = transaction.status === "pending";

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="sm:max-w-md bg-[#1a1a1a] border-gray-800"
        data-testid="receipt-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-white font-medium text-center">
            {isWithdrawal ? "Withdrawal Receipt" : "Deposit Receipt"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Amount + status */}
          <div className="text-center space-y-2">
            <p className="text-gray-500 text-xs uppercase tracking-wide">Amount</p>
            <p className="text-white font-mono text-2xl">
              {amount} {currency}
            </p>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs capitalize ${getStatusStyles(transaction.status)}`}
              data-testid="receipt-status"
            >
              {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              {(transaction.status === "approved" || transaction.status === "completed") && <CheckCircle className="w-3 h-3" />}
              {transaction.status === "rejected" && <XCircle className="w-3 h-3" />}
              {getStatusLabel(transaction.status)}
            </span>
          </div>

          {/* Details */}
          <div className="space-y-3 border-t border-gray-800 pt-4">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 text-sm">Type</span>
              <span className="text-white text-sm" data-testid="receipt-type">
                {isWithdrawal ? "Withdrawal" : "Deposit"}
              </span>
            </div>

            {transaction.network && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 text-sm">Network</span>
                <span className="text-white text-sm">{transaction.network}</span>
              </div>
            )}

            {currency && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 text-sm">Currency</span>
                <span className="text-white text-sm">{currency}</span>
              </div>
            )}

            {transaction.address && (
              <div className="space-y-1">
                <p className="text-gray-500 text-sm">
                  {isWithdrawal ? "Withdrawal Address" : "Address"}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-white text-xs font-mono break-all flex-1" data-testid="receipt-address">
                    {transaction.address}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-gray-400 hover:text-white hover:bg-[#2a2a2a]"
                    onClick={() => copyValue(transaction.address!, "address", "Wallet address")}
                    data-testid="receipt-copy-address"
                  >
                    {copiedField === "address" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-gray-500 text-sm">Transaction Hash</p>
              {transaction.txHash ? (
                <div className="flex items-center gap-2">
                  <span className="text-white text-xs font-mono break-all flex-1" data-testid="receipt-txhash">
                    {transaction.txHash}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-gray-400 hover:text-white hover:bg-[#2a2a2a]"
                    onClick={() => copyValue(transaction.txHash!, "txHash", "Transaction hash")}
                    data-testid="receipt-copy-txhash"
                  >
                    {copiedField === "txHash" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              ) : (
                <p className="text-gray-600 text-xs" data-testid="receipt-txhash">
                  {isPending ? "Assigned once the transaction is processed" : "Not available"}
                </p>
              )}
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-gray-500 text-sm">Date &amp; Time</span>
              <span className="text-white text-sm font-mono" data-testid="receipt-datetime">
                {formatUtcDateTime(transaction.createdAt)}
              </span>
            </div>
          </div>

          {isPending && (
            <p className="text-[10px] text-gray-500 border-t border-gray-800 pt-3">
              {isWithdrawal
                ? "Your withdrawal is pending review and is processed within 24-48 hours after verification."
                : "Your deposit is pending confirmation."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
