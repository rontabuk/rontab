"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { UserRound, X } from "lucide-react";

export function ProfileImageUpload({
  inputId,
  name,
  removeName,
  label,
  removeLabel,
  currentUrl,
  alt,
  fallbackText,
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
  }

  function handleRemoveChange(event: ChangeEvent<HTMLInputElement>) {
    const shouldRemove = event.currentTarget.checked;
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
    <div className={`profile-image-upload ${className}`.trim()}>
      <label className="profile-image-upload-label" htmlFor={inputId}>{label}</label>
      <div className="profile-image-upload-preview">
        {previewUrl
          ? <Image src={previewUrl} alt={alt} width={88} height={88} unoptimized />
          : fallbackText
            ? <span>{fallbackText}</span>
            : <UserRound size={32} aria-hidden="true" />}
      </div>
      <input ref={inputRef} id={inputId} name={name} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} />
      <small>JPEG, PNG, or WebP. Maximum 5 MB.</small>
      {hasSelection && <button className="profile-image-upload-clear" type="button" onClick={clearSelection}><X size={13} aria-hidden="true" />Clear selection</button>}
      {currentUrl && !hasSelection && (
        <label className="profile-image-upload-remove">
          <input name={removeName} type="checkbox" checked={removeImage} onChange={handleRemoveChange} />
          {removeLabel}
        </label>
      )}
    </div>
  );
}