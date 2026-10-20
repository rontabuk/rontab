"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";
import { deleteSellerProduct } from "@/app/seller/(protected)/actions";

type DeletableProduct = { id: string; name: string };

export function DeleteProductDialog({ product, onCancel }: { product: DeletableProduct; onCancel: () => void }) {
  return (
    <div className="seller-confirm-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="seller-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-product-title" onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}>
        <p className="admin-eyebrow">DELETE PRODUCT</p>
        <h2 id="delete-product-title">Delete {product.name}?</h2>
        <p>This permanently removes the product and its photos or Reel from your shop.</p>
        <form className="seller-confirm-actions" action={deleteSellerProduct}>
          <input name="product_id" type="hidden" value={product.id} />
          <DialogButtons onCancel={onCancel} />
        </form>
      </section>
    </div>
  );
}

function DialogButtons({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button className="seller-confirm-cancel" type="button" autoFocus disabled={pending} onClick={onCancel}>Keep product</button>
      <button className="seller-confirm-delete" type="submit" disabled={pending}>
        {pending && <Loader2 className="seller-confirm-spinner" size={14} aria-hidden="true" />}
        {pending ? "Deleting..." : "Delete permanently"}
      </button>
    </>
  );
}

export function DeleteProductButton({ product }: { product: DeletableProduct }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="seller-danger-button" type="button" onClick={() => setOpen(true)}>
        <Trash2 size={15} aria-hidden="true" />Delete product
      </button>
      {open && <DeleteProductDialog product={product} onCancel={() => setOpen(false)} />}
    </>
  );
}
