"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/client/api-client";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const OUTPUT_SIZE = 320;

function validateProfilePhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Profile photos must be smaller than 8 MB.");
}

function cropCoordinates(image: HTMLImageElement, zoom: number, positionX: number, positionY: number) {
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  return {
    sourceSize,
    sourceX: (image.naturalWidth - sourceSize) * ((positionX + 100) / 200),
    sourceY: (image.naturalHeight - sourceSize) * ((positionY + 100) / 200),
  };
}

function ProfileCropDialog({ file, onCancel, onApply }: { file: File; onCancel: () => void; onApply: (image: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; positionX: number; positionY: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(0);
  const [positionY, setPositionY] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setReady(true);
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const crop = cropCoordinates(image, zoom, positionX, positionY);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, crop.sourceX, crop.sourceY, crop.sourceSize, crop.sourceSize, 0, 0, canvas.width, canvas.height);
  }, [positionX, positionY, ready, zoom]);

  function applyCrop() {
    const image = imageRef.current;
    if (!image) return;
    const output = document.createElement("canvas");
    output.width = OUTPUT_SIZE;
    output.height = OUTPUT_SIZE;
    const context = output.getContext("2d");
    if (!context) return;
    const crop = cropCoordinates(image, zoom, positionX, positionY);
    context.drawImage(image, crop.sourceX, crop.sourceY, crop.sourceSize, crop.sourceSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    onApply(output.toDataURL("image/jpeg", 0.86));
  }

  function moveCrop(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const sensitivity = 100 / Math.max(120, event.currentTarget.clientWidth / 2);
    setPositionX(Math.max(-100, Math.min(100, drag.positionX - (event.clientX - drag.x) * sensitivity)));
    setPositionY(Math.max(-100, Math.min(100, drag.positionY - (event.clientY - drag.y) * sensitivity)));
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-crop-title">
      <div className="w-full max-w-sm rounded-lg border border-outline-variant/25 bg-surface-high p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 id="profile-crop-title" className="text-sm font-semibold text-on-surface">Crop profile photo</h3>
          <button type="button" onClick={onCancel} aria-label="Close crop dialog" title="Close" className="flex h-8 w-8 items-center justify-center rounded-md text-outline transition hover:bg-surface-highest hover:text-on-surface">
            <span className="material-symbols-outlined text-lg" aria-hidden="true">close</span>
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={280}
          height={280}
          className="aspect-square w-full cursor-move touch-none rounded-full border border-primary/25 bg-surface-base object-cover"
          onPointerDown={(event) => {
            dragRef.current = { x: event.clientX, y: event.clientY, positionX, positionY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={moveCrop}
          onPointerUp={(event) => {
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
        <label className="mt-4 flex items-center gap-3 text-[0.68rem] font-medium text-on-surface-variant">
          <span className="material-symbols-outlined text-base text-outline" aria-hidden="true">zoom_out</span>
          <input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="min-w-0 flex-1 accent-primary" aria-label="Photo zoom" />
          <span className="material-symbols-outlined text-base text-outline" aria-hidden="true">zoom_in</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 rounded-md border border-outline-variant/25 px-3 text-xs font-medium text-on-surface-variant">Cancel</button>
          <button type="button" disabled={!ready} onClick={applyCrop} className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-on-primary disabled:opacity-50">Apply photo</button>
        </div>
      </div>
    </div>
  );
}

export function ProfileAvatar({ image, name, size = "md" }: { image: string | null | undefined; name: string; size?: "sm" | "md" | "lg" }) {
  const dimensions = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  return (
    <div className={`${dimensions} shrink-0 overflow-hidden rounded-full bg-primary/10 ring-1 ring-primary/10`}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- Profile photos are local data URLs returned by the authenticated API.
        <img src={image} alt={`${name} profile`} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center material-symbols-outlined text-primary" aria-hidden="true">person</span>
      )}
    </div>
  );
}

export function ProfilePhotoEditor({
  image,
  name,
  subtitle,
  enabled,
  onChange,
}: {
  image: string | null | undefined;
  name: string;
  subtitle: string;
  enabled: boolean;
  onChange: (image: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  async function saveImage(nextImage: string | null) {
    const result = await apiClient.patch<{ image: string | null }>("/api/v1/auth/profile", { image: nextImage });
    onChange(result.image);
  }

  async function selectPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      validateProfilePhoto(file);
      setCropFile(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profile photo could not be saved.");
    }
  }

  async function applyPhoto(nextImage: string) {
    setCropFile(null);
    setBusy(true);
    setError(null);
    try {
      await saveImage(nextImage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profile photo could not be saved.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removePhoto() {
    setBusy(true);
    setError(null);
    try {
      await saveImage(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profile photo could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {cropFile && <ProfileCropDialog file={cropFile} onCancel={() => { setCropFile(null); if (inputRef.current) inputRef.current.value = ""; }} onApply={(nextImage) => void applyPhoto(nextImage)} />}
      <div className="relative">
        <ProfileAvatar image={image} name={name} size="lg" />
        {enabled && (
          <button
            type="button"
            title="Change profile photo"
            aria-label="Change profile photo"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-high bg-primary text-on-primary shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[0.8rem]" aria-hidden="true">photo_camera</span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={!enabled || busy}
          onChange={(event) => void selectPhoto(event.target.files?.[0])}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-on-surface">{name}</p>
        <p className="truncate text-[0.65rem] text-outline">{subtitle}</p>
        {enabled && (
          <div className="mt-1 flex items-center gap-3">
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="text-[0.65rem] font-medium text-primary disabled:opacity-50">
              {busy ? "Saving..." : image ? "Change photo" : "Add photo"}
            </button>
            {image && <button type="button" disabled={busy} onClick={() => void removePhoto()} className="text-[0.65rem] font-medium text-outline transition hover:text-error disabled:opacity-50">Remove</button>}
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-[0.62rem] text-error">{error}</p>}
      </div>
    </div>
  );
}
