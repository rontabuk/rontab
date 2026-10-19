"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Trash2, Undo2, UserRound, X } from "lucide-react";

export function ProfileImageUpload({
  inputId,
  name,
  removeName,
  label,
  removeLabel,
  currentUrl,
  alt,
  fallbackText,
  compact = false,
  className = "",
}: {
  inputId: string;
  name: string;
  removeName: string;
  label: string;
  removeLabel: string;
  currentUrl: string | null;
  alt: string;
  fallbackText?: string;
  compact?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState(currentUrl);
  const [hasSelection, setHasSelection] = useState(false);
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const file = event.currentTarget.files?.[0];
    objectUrlRef.current = file ? URL.createObjectURL(file) : null;
    setPreviewUrl(objectUrlRef.current ?? currentUrl);
    setHasSelection(Boolean(file));
    setRemoveImage(false);
  }

  function clearSelection() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setPreviewUrl(currentUrl);
    setHasSelection(false);
    setRemoveImage(false);
  }

  function handleRemoveChange(event: ChangeEvent<HTMLInputElement>) {
    toggleRemoval(event.currentTarget.checked);
  }

  function toggleRemoval(shouldRemove: boolean) {
    setRemoveImage(shouldRemove);
    if (shouldRemove) {
      clearSelection();
      setPreviewUrl(null);
      setRemoveImage(true);
    } else {
      setPreviewUrl(currentUrl);
    }
  }

  return (
    <div className={`profile-image-upload${compact ? " profile-image-upload-compact" : ""} ${className}`.trim()}>
      <label className="profile-image-upload-label" htmlFor={inputId}>{label}</label>
      <div className="profile-image-upload-preview">
        {previewUrl
          ? <Image src={previewUrl} alt={alt} width={88} height={88} unoptimized />
          : fallbackText
            ? <span>{fallbackText}</span>
            : <UserRound size={32} aria-hidden="true" />}
      </div>
      <input className={compact ? "visually-hidden" : undefined} ref={inputRef} id={inputId} name={name} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} />
      {compact && (
        <div className="profile-image-upload-actions">
          <label className="profile-image-upload-select" htmlFor={inputId}><ImagePlus size={16} aria-hidden="true" />{previewUrl ? "Change logo" : "Upload logo"}</label>
          {currentUrl && !hasSelection && (
            <button className="profile-image-upload-remove-button" type="button" aria-pressed={removeImage} onClick={() => toggleRemoval(!removeImage)}>
              {removeImage ? <Undo2 size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
              {removeImage ? "Restore logo" : removeLabel}
            </button>
          )}
          {removeImage && <input type="hidden" name={removeName} value="on" />}
        </div>
      )}
      <small>{compact ? "JPG, PNG, WebP / 5 MB" : "JPEG, PNG, or WebP. Maximum 5 MB."}</small>
      {hasSelection && <button className="profile-image-upload-clear" type="button" onClick={clearSelection}><X size={13} aria-hidden="true" />Clear selection</button>}
      {!compact && currentUrl && !hasSelection && (
        <label className="profile-image-upload-remove">
          <input name={removeName} type="checkbox" checked={removeImage} onChange={handleRemoveChange} />
          {removeLabel}
        </label>
      )}
    </div>
  );
}