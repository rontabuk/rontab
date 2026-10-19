"use client";

import { useActionState, useState } from "react";
import { Search, TicketCheck } from "lucide-react";
import { inspectSellerOfferVoucher } from "@/app/seller/(protected)/product-offer-actions";
import { redeemSellerOfferCoupon } from "@/app/seller/(protected)/actions";

export function SellerVoucherRedeemer() {
  const [code, setCode] = useState("");
  const [state, checkVoucher, pending] = useActionState(inspectSellerOfferVoucher, { error: null, voucher: null });
  const voucher = state.voucher?.code === code.trim().toUpperCase() ? state.voucher : null;
  return <div className="seller-voucher-checker">
    <form action={checkVoucher}>
      <label htmlFor="seller-offer-coupon-code">Voucher code</label>
      <input id="seller-offer-coupon-code" name="coupon_code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" spellCheck={false} minLength={20} maxLength={20} pattern="[A-Fa-f0-9]{20}" required />
      <button className="admin-primary-button" type="submit" disabled={pending}><Search size={15} aria-hidden="true" />{pending ? "Checking…" : "Check voucher"}</button>
    </form>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {voucher && <section className="seller-voucher-inspection" aria-label="Voucher details" aria-live="polite">
      <h3>{voucher.title}</h3><p>{voucher.benefit}</p>
      <p>{voucher.branch}{voucher.postcode && ` · ${voucher.postcode}`}</p>
      <p>{voucher.date} · {voucher.startsAt.slice(0, 5)}–{voucher.endsAt.slice(0, 5)} UK time</p>
      <strong>{voucher.status}</strong>
      {voucher.canRedeem ? <form action={redeemSellerOfferCoupon}>
        <input type="hidden" name="coupon_code" value={voucher.code} />
        <label><input type="checkbox" name="confirm_handover" required /><span>I am handing the advertised benefit to the voucher holder now.</span></label>
        <button className="admin-primary-button" type="submit" disabled={pending}><TicketCheck size={15} aria-hidden="true" />Confirm used</button>
      </form> : <p>This voucher cannot be used now. Checking it has not consumed it.</p>}
    </section>}
  </div>;
}