"use client";

import { useState } from "react";
import { BadgeCheck, Copy, Download, FileDown, Share2 } from "lucide-react";
import { CreatorVerificationBadge } from "@/components/creator/CreatorVerificationBadge";
import { formatNumber } from "@/lib/format";

type CreatorFanToolsProps = {
  displayName: string;
  code: string;
  profileUrl: string;
  fanCount: number;
  firstReferralCount?: number;
  platforms: string[];
};

function drawWrappedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.trim().split(/\s+/);
  let line = "";
  const lines: string[] = [];
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  lines.forEach((entry, index) => context.fillText(entry, x, y + index * lineHeight, maxWidth));
  return lines.length;
}

async function createCertificateCanvas({ displayName, code, fanCount, platforms }: CreatorFanToolsProps) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 2400;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare the certificate image.");

  context.fillStyle = "#f7f8f4";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fcfdf9";
  context.fillRect(80, 80, canvas.width - 160, canvas.height - 160);
  context.strokeStyle = "#34483a";
  context.lineWidth = 5;
  context.strokeRect(116, 116, canvas.width - 232, canvas.height - 232);
  context.fillStyle = "#c77b5c";
  context.fillRect(116, 116, 28, 300);

  context.textAlign = "center";
  context.fillStyle = "#34483a";
  context.font = "600 70px Georgia, serif";
  context.fillText("rontab", canvas.width / 2, 310);
  context.fillStyle = "#c77b5c";
  context.fillText(".", canvas.width / 2 + context.measureText("rontab").width / 2 + 2, 310);

  context.fillStyle = "#60715d";
  context.font = "700 26px Arial, sans-serif";
  context.fillText("CREATOR CERTIFICATE", canvas.width / 2, 565);
  context.strokeStyle = "#dce3d8";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(350, 630);
  context.lineTo(1450, 630);
  context.stroke();

  context.fillStyle = "#737c71";
  context.font = "400 30px Arial, sans-serif";
  context.fillText("Recognized creator on Rontab", canvas.width / 2, 795);
  context.fillStyle = "#29332a";
  context.font = "400 86px Georgia, serif";
  const nameLines = drawWrappedText(context, displayName, canvas.width / 2, 940, 1320, 110);

  const isBlue = fanCount >= 10000;
  const badgeY = 1030 + Math.max(0, nameLines - 1) * 110;
  const badgeText = isBlue ? "10,000+ RONTAB FANS" : "ADMIN-APPROVED CREATOR";
  context.font = "700 24px Arial, sans-serif";
  const badgeWidth = context.measureText(badgeText).width + 64;
  context.fillStyle = isBlue ? "#e8f0fa" : "#eceeea";
  context.fillRect((canvas.width - badgeWidth) / 2, badgeY, badgeWidth, 58);
  context.fillStyle = isBlue ? "#315f91" : "#5d665e";
  context.fillText(badgeText, canvas.width / 2, badgeY + 39);

  context.fillStyle = "#737c71";
  context.font = "400 28px Arial, sans-serif";
  context.fillText("RONTAB FAN CODE", canvas.width / 2, 1320 + (nameLines - 1) * 110);
  context.fillStyle = "#34483a";
  context.font = "600 78px Arial, sans-serif";
  context.fillText(code, canvas.width / 2, 1435 + (nameLines - 1) * 110);
  context.fillStyle = "#60715d";
  context.font = "400 29px Arial, sans-serif";
  context.fillText(`${formatNumber(fanCount)} fans follow this creator`, canvas.width / 2, 1515 + (nameLines - 1) * 110);

  context.strokeStyle = "#dce3d8";
  context.beginPath();
  context.moveTo(350, 1685 + (nameLines - 1) * 110);
  context.lineTo(1450, 1685 + (nameLines - 1) * 110);
  context.stroke();
  context.fillStyle = "#737c71";
  context.font = "400 27px Arial, sans-serif";
  context.fillText("Find me on", canvas.width / 2, 1770 + (nameLines - 1) * 110);
  context.fillStyle = "#34483a";
  context.font = "600 32px Arial, sans-serif";
  drawWrappedText(context, platforms.length ? platforms.join("  ·  ") : "Rontab", canvas.width / 2, 1845 + (nameLines - 1) * 110, 1280, 48);

  context.fillStyle = "#858d82";
  context.font = "400 22px Arial, sans-serif";
  context.fillText("Enter this code in Rontab to follow this creator.", canvas.width / 2, 2180);
  context.fillStyle = "#c77b5c";
  context.fillRect(760, 2250, 280, 8);
  return canvas;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function CreatorFanTools(props: CreatorFanToolsProps) {
  const [feedback, setFeedback] = useState("");
  const filename = props.displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rontab-creator";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(props.code);
      setFeedback("Fan code copied.");
    } catch {
      setFeedback("Copy is unavailable in this browser. Select the code to copy it.");
    }
  }

  async function shareProfile() {
    const profileUrl = `${window.location.origin}${props.profileUrl}`;
    const shareData = { title: `${props.displayName} on Rontab`, text: `Follow ${props.displayName} on Rontab with code ${props.code}.`, url: profileUrl };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(`${shareData.text} ${profileUrl}`);
        setFeedback("Profile link and fan code copied.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setFeedback("Sharing is unavailable in this browser.");
    }
  }

  async function downloadPng() {
    try {
      const canvas = await createCertificateCanvas(props);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((file) => file ? resolve(file) : reject(new Error("Could not create the PNG file.")), "image/png"));
      downloadBlob(blob, `${filename}-rontab-creator.png`);
      setFeedback("High-quality PNG certificate downloaded.");
    } catch {
      setFeedback("The PNG certificate could not be created in this browser.");
    }
  }

  async function downloadPdf() {
    try {
      const canvas = await createCertificateCanvas(props);
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
      pdf.save(`${filename}-rontab-creator.pdf`);
      setFeedback("PDF certificate downloaded.");
    } catch {
      setFeedback("The PDF certificate could not be created in this browser.");
    }
  }

  return (
    <section className="creator-fan-tools" aria-label="Creator fan code and sharing">
      <div className="creator-fan-tools-identity">
        <div className="creator-fan-tools-name-line">
          <h2>{props.displayName}</h2>
          <CreatorVerificationBadge fanCount={props.fanCount} />
        </div>
        <p className="creator-fan-tools-label">Your fan code</p>
        <strong className="creator-fan-tools-code">{props.code}</strong>
        {props.firstReferralCount !== undefined && <small className="creator-fan-tools-referrals">{formatNumber(props.firstReferralCount)} original referrals</small>}
      </div>
      <div className="creator-fan-tools-actions">
        <button type="button" onClick={copyCode} aria-label="Copy fan code" title="Copy fan code"><Copy size={17} aria-hidden="true" /></button>
        <button type="button" onClick={shareProfile} aria-label="Share creator profile" title="Share profile"><Share2 size={17} aria-hidden="true" /></button>
        <button type="button" onClick={downloadPng} aria-label="Download PNG certificate" title="Download PNG certificate"><Download size={17} aria-hidden="true" /></button>
        <button type="button" onClick={downloadPdf} aria-label="Download PDF certificate" title="Download PDF certificate"><FileDown size={17} aria-hidden="true" /></button>
      </div>
      <p className="creator-fan-tools-caption"><BadgeCheck size={13} aria-hidden="true" />{formatNumber(props.fanCount)} fans · {props.platforms.length ? `Share on ${props.platforms.join(", ")} or anywhere your audience follows you.` : "Share your profile and fan code with your audience."}</p>
      <p className="creator-fan-tools-feedback" role="status" aria-live="polite">{feedback}</p>
    </section>
  );
}