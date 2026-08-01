/**
 * Generates a branded PDF with login credentials using Canvas API.
 * No external dependencies — pure browser APIs.
 */

export function downloadCredentialsPdf(params: {
  email: string;
  password: string;
  role: string;
  platformUrl: string;
}) {
  const { email, password, role, platformUrl } = params;

  const width = 800;
  const height = 500;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);

  // Load the real logo and draw once ready.
  const logo = new Image();
  logo.crossOrigin = "anonymous";
  logo.src = "/brand/postsider-logo.png";

  const draw = () => {
    // Background
    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, width, height);

    // Left accent bar
    ctx.fillStyle = "#0F0F0F";
    ctx.fillRect(0, 0, 6, height);

    // Logo (real image). drawImage on a "broken" image element throws
    // InvalidStateError — the onerror fallback runs `draw`, so skip the logo
    // when it never loaded (network issue / blocked asset).
    const logoSize = 48;
    if (logo.complete && logo.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(36 + logoSize / 2, 36 + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logo, 36, 36, logoSize, logoSize);
      ctx.restore();
    }

    // Brand name
    ctx.fillStyle = "#0F0F0F";
    ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("PostSider", 96, 60);

    // Divider
    ctx.strokeStyle = "#E5E5E5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(36, 110);
    ctx.lineTo(width - 36, 110);
    ctx.stroke();

    // Title
    ctx.fillStyle = "#0F0F0F";
    ctx.textBaseline = "top";
    ctx.font = "600 20px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Your login credentials", 36, 135);

    // Subtitle
    ctx.fillStyle = "#737373";
    ctx.font = "400 13px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(
      "Use these to sign in for the first time. You'll be asked to set your own password.",
      36,
      165,
    );

    // Credentials card
    const cardY = 200;
    const cardH = 160;
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "#E5E5E5";
    ctx.lineWidth = 1;
    roundRect(ctx, 36, cardY, width - 72, cardH, 12);
    ctx.fill();
    ctx.stroke();

    // Labels + values
    const labelX = 60;
    const valueX = 190;
    let y = cardY + 32;

    ctx.fillStyle = "#737373";
    ctx.font = "500 12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("PLATFORM", labelX, y);
    ctx.fillStyle = "#0F0F0F";
    ctx.font = "500 15px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(platformUrl, valueX, y);

    y += 38;
    ctx.fillStyle = "#737373";
    ctx.font = "500 12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("EMAIL", labelX, y);
    ctx.fillStyle = "#0F0F0F";
    ctx.font = "500 15px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(email, valueX, y);

    y += 38;
    ctx.fillStyle = "#737373";
    ctx.font = "500 12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("PASSWORD", labelX, y);
    ctx.fillStyle = "#0F0F0F";
    ctx.font = "bold 17px 'Courier New', monospace";
    ctx.fillText(password, valueX, y);

    y += 38;
    ctx.fillStyle = "#737373";
    ctx.font = "500 12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("ROLE", labelX, y);
    ctx.fillStyle = "#0F0F0F";
    ctx.font = "500 15px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(role, valueX, y);

    // Footer
    ctx.fillStyle = "#A3A3A3";
    ctx.font = "400 11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(
      "This is a one-time password. After signing in you will set your own.",
      36,
      height - 60,
    );
    ctx.fillText(
      `Generated ${new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}`,
      36,
      height - 40,
    );

    // Export
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `postsider-credentials-${email.split("@")[0]}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  // If logo is already cached it may fire synchronously.
  if (logo.complete && logo.naturalWidth > 0) {
    draw();
  } else {
    logo.onload = draw;
    // Fallback if logo fails to load — draw without it.
    logo.onerror = draw;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
