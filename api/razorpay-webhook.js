import crypto from "crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Razorpay from "razorpay";

// 1. Firebase Admin SDK Initialization (Cold Start से बचने के लिए)
if (!getApps().length) {
  try {
    // Netlify Environment Variable से Base64 स्ट्रिंग लें
    const base64Str = process.env.FIREBASE_SERVICE_ACCOUNT || "";
    // Base64 को डिकोड करके JSON में बदलें
    const serviceAccount = JSON.parse(
      Buffer.from(base64Str, "base64").toString("utf8")
    );
    
    // private_key में \n की समस्या को ठीक करें
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    
    initializeApp({
      credential: cert(serviceAccount),
    });
    console.log("✅ Firebase Admin Initialized Successfully");
  } catch (error) {
    console.error("❌ Firebase Admin Initialization Failed:", error);
  }
}

const db = getFirestore();

// 2. पैकेज कॉन्फ़िगरेशन
function getPackageConfig(planName) {
  const name = String(planName || "").toLowerCase();
  if (name.includes("long-term peace") || name.includes("2 years") || name.includes("2999")) {
    return { days: 730, visits: "16/16" };
  }
  if (name.includes("super protective") || name.includes("1999")) {
    return { days: 365, visits: "12/12" };
  }
  if (name.includes("family guard") || name.includes("999")) {
    return { days: 365, visits: "5/5" };
  }
  return { days: 365, visits: "3/3" };
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    console.log("🚀 Webhook received. Method:", event.httpMethod);

    const headers = event.headers || {};
    const signature = headers["x-razorpay-signature"] || headers["X-Razorpay-Signature"];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      console.error("❌ Missing signature or secret");
      return jsonResponse(400, { error: "Missing signature or secret" });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";

    // Razorpay की आधिकारिक लाइब्रेरी से सिग्नेचर वेरिफाई करें (Timing safe comparison)
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const isValidSignature = Razorpay.validateWebhookSignature(
      rawBody,
      signature,
      webhookSecret
    );

    if (!isValidSignature) {
      console.error("❌ Invalid webhook signature");
      return jsonResponse(400, { error: "Invalid webhook signature" });
    }

    console.log("✅ Webhook signature verified");
    const eventData = JSON.parse(rawBody);

    if (eventData.event === "payment.captured") {
      const payment = eventData.payload?.payment?.entity || {};
      const notes = payment.notes || {};
      const userId = notes.userId;
      const paymentId = payment.id;

      console.log("📦 Payment Captured. userId:", userId, "paymentId:", paymentId);

      if (!userId || !paymentId) {
        console.warn("⚠️ Webhook ignored: missing userId or paymentId");
        return jsonResponse(200, { status: "Ignored: missing userId or paymentId" });
      }

      const orderRef = db.collection("orders").doc(paymentId);
      const existingOrder = await orderRef.get();
      if (existingOrder.exists) {
        console.log("ℹ️ Order already recorded for paymentId:", paymentId);
        return jsonResponse(200, { status: "Already recorded" });
      }

      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        console.error(`❌ User ${userId} not found for payment ${paymentId}`);
        return jsonResponse(200, { status: "Ignored: user not found" });
      }

      const amountRupees = Number(payment.amount || 0) / 100;
      const itemType = notes.itemType || "product";
      const planName = notes.packageName || "Annual Repair Package";

      // Order Save
      await orderRef.set({
        paymentId,
        orderId: payment.order_id || "",
        userId,
        totalAmount: amountRupees,
        itemType,
        items: notes.items || notes.itemTitle || planName,
        status: "Completed",
        createdAt: FieldValue.serverTimestamp(),
      });
      console.log("✅ Order saved in Firestore for:", paymentId);

      // Subscription Save (अगर itemType package है या planName मौजूद है)
      if (itemType === "package" || planName) {
        const pkgCfg = getPackageConfig(planName);
        const expiryDate = new Date(Date.now() + pkgCfg.days * 24 * 60 * 60 * 1000).toISOString();

        await db.collection("subscriptions").doc(paymentId).set({
          userId,
          planName,
          price: amountRupees,
          paymentId,
          remainingVisits: pkgCfg.visits,
          expiryDate,
          createdAt: FieldValue.serverTimestamp(),
        });
        console.log("✅ Subscription saved in Firestore for:", paymentId);

        await userRef.set(
          {
            isPremium: true,
            activePlan: planName,
            planExpiry: expiryDate,
          },
          { merge: true }
        );
        console.log("✅ User profile updated for:", userId);
      }
    }

    return jsonResponse(200, { status: "ok" });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return jsonResponse(500, { error: "Webhook processing failed" });
  }
}