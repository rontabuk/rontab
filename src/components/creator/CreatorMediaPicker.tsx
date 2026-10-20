"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { UserRound } from "lucide-react";

export function CreatorMediaPicker({ kind, initialUrl, required = false }: { kind: "profile" | "cover"; initialUrl: string | null; required?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState(initialUrl);
  const [removeImage, setRemoveImage] = useState(false);
  const isProfile = kind === "profile";
  const inputId = isProfile ? "creator-profile-image" : "creator-cover-image";
  const label = isProfile ? "Profile picture" : "Cover image";
  const removeName = isProfile ? "remove_profile_image" : "remove_cover_image";

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const file = event.currentTarget.files?.[0];
    objectUrlRef.current = file ? URL.createObjectURL(file) : null;
    setPreviewUrl(objectUrlRef.current ?? initialUrl);
    setRemoveImage(false);
  }

  function handleRemoveChange(event: ChangeEvent<HTMLInputElement>) {
    const shouldRemove = event.currentTarget.checked;
    setRemoveImage(shouldRemove);
    if (shouldRemove) {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      if (inputRef.current) inputRef.current.value = "";
      setPreviewUrl(null);
    } else {
      setPreviewUrl(initialUrl);
    }
  }

  return (
    <div className="creator-profile-image-field">
      <span className="creator-profile-image-label">{label}</span>
      {isProfile ? (
        <div className="creator-profile-avatar creator-profile-avatar-preview">
          {previewUrl ? <Image src={previewUrl} alt="Creator profile picture preview" width={88} height={88} unoptimized /> : <UserRound size={32} aria-hidden="true" />}
        </div>
      ) : (
        <div className="creator-profile-cover creator-profile-cover-preview">
          {previewUrl
            ? <Image src={previewUrl} alt="Creator cover image preview" fill unoptimized sizes="(max-width: 700px) 100vw, 560px" />
            : <div className="creator-profile-cover-default"><span>CREATORS</span></div>}
        </div>
      )}
      <label htmlFor={inputId}>Choose {label.toLowerCase()}</label>
      <input ref={inputRef} id={inputId} name={isProfile ? "profile_image" : "cover_image"} type="file" accept="image/jpeg,image/png,image/webp" required={required} onChange={handleFileChange} />
      <small>JPEG, PNG, or WebP. Maximum 5 MB.</small>
      {(previewUrl || removeImage) && (
        <label className="creator-profile-remove-image">
          <input name={removeName} type="checkbox" checked={removeImage} onChange={handleRemoveChange} />
          Remove {label.toLowerCase()}
        </label>
      )}
    </div>
  );
}