import admin from "../firebase-admin.js";
import { getMessaging } from "firebase-admin/messaging";
import User from "../models/user.model.js";

const messaging = getMessaging(admin.app());

const RESERVED_FCM_KEYS = new Set(["from", "notification", "message_type", "collapse_key"]);
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

function toFcmStringData(extraData = {}) {
  const stringData = {};
  for (const [key, value] of Object.entries(extraData)) {
    if (value === undefined || value === null) continue;
    if (RESERVED_FCM_KEYS.has(key) || key.startsWith("google") || key.startsWith("gcm")) continue;
    stringData[key] = String(value);
  }
  return stringData;
}

export function isInvalidFcmTokenError(error) {
  return INVALID_TOKEN_CODES.has(error?.code);
}

export async function clearInvalidFcmToken(fcmToken, error) {
  if (!fcmToken || !isInvalidFcmTokenError(error)) return;
  try {
    const result = await User.updateMany({ fcmToken }, { $set: { fcmToken: null } });
    if (result.modifiedCount) {
      console.warn(`Cleared invalid FCM token from ${result.modifiedCount} user(s)`);
    }
  } catch (clearError) {
    console.error("Failed to clear invalid FCM token:", clearError?.message || clearError);
  }
}

function logRejectedToken(error) {
  if (
    isInvalidFcmTokenError(error)
    || error?.code === "messaging/mismatched-credential"
  ) {
    console.error(
      "FCM token rejected. Ensure GOOGLE_APPLICATION_CREDENTIALS_JSON on Render uses the same Firebase project as the mobile app (dealr-app-494db)."
    );
  }
}

/**
 * Send a chat notification to a single FCM device token
 * @param {string} toFcmToken - The FCM device token
 * @param {string} messageText - The chat message text
 * @param {string} senderName - The sender's name
 */
export async function sendChatNotification(toFcmToken, messageText, senderName, extraData = {}) {
   try {
    const stringData = toFcmStringData(extraData);

    const message = {
        token: toFcmToken,
        notification: {
            title: `${senderName}`,
            body: messageText,
        },
        data: {
            type: "CHAT",
            senderName,
            messageText,
            ...stringData,
        },
        android: {
            notification: {
                channelId: "default",
            },
        },
    };
    console.log("Sending chat notification to token:", toFcmToken.slice(0, 12) + "...");
    await messaging.send(message);
    console.log("Chat notification sent successfully");
    } catch (error) {
        console.error("Error sending chat notification:", error?.code || error?.message || error);
        logRejectedToken(error);
        await clearInvalidFcmToken(toFcmToken, error);
    }
}

/**
 * Prompt a user to leave a review after a completed sale
 */
export async function sendReviewPromptNotification(toFcmToken, { adId, adTitle, revieweeName }) {
  try {
    const message = {
      token: toFcmToken,
      notification: {
        title: "How was your experience?",
        body: `Rate your experience for "${adTitle}" with ${revieweeName}.`,
      },
      data: {
        type: "REVIEW_PROMPT",
        adId: String(adId),
        adTitle: adTitle || '',
        revieweeName: revieweeName || '',
      },
      android: {
        notification: {
          channelId: "default",
        },
      },
    };
    await messaging.send(message);
  } catch (error) {
    console.error("Error sending review prompt notification:", error?.code || error?.message || error);
    logRejectedToken(error);
    await clearInvalidFcmToken(toFcmToken, error);
  }
}

/**
 * Reason-based re-engagement push. `campaign` is required so the app can
 * deep-link; never send a generic "open the app" payload through this helper.
 */
export async function sendReengagementNotification(toFcmToken, { title, body, data = {} }) {
  try {
    const stringData = toFcmStringData(data);
    const message = {
      token: toFcmToken,
      notification: {
        title,
        body,
      },
      data: {
        type: "REENGAGEMENT",
        ...stringData,
      },
      android: {
        notification: {
          channelId: "default",
        },
      },
    };
    await messaging.send(message);
    return { sent: true };
  } catch (error) {
    console.error("Error sending re-engagement notification:", error?.code || error?.message || error);
    logRejectedToken(error);
    await clearInvalidFcmToken(toFcmToken, error);
    return { sent: false, error: error?.code || error?.message || "send_failed" };
  }
}
