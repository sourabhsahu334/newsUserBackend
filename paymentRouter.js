import express from 'express';
const router = express.Router();
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { client } from './db/connect.js';
import authMiddleware from './middleware/authMiddleware.js';
import { ObjectId } from 'mongodb';

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Plan Configuration
const PLAN_CONFIG = {
  'Starter': { credits: 50, validityDays: 30 },
  'Professional': { credits: 120, validityDays: 60 },
  'Enterprise': { credits: 350, validityDays: 90 }
};

// Create Order Endpoint
router.post('/create-order', authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100, // convert to paise
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
      notes: {
        ...notes,
        userId: req.user._id.toString(),
        userEmail: req.user.email
      },
      payment_capture: 1
    });

    // Store order in database for tracking
    const db = client.db('Interest');
    const ordersCollection = db.collection('orders');

    await ordersCollection.insertOne({
      orderId: order.id,
      userId: req.user._id,
      userEmail: req.user.email,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      notes: order.notes,
      status: 'created',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      order,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});



// lib/paypal.js
export async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(
    `${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Failed to get PayPal access token");
  }

  return data.access_token;
}


router.post("/create-order-paypal", authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const { amount, currency = "USD", planName } = req.body;

    if (!amount || !planName) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              description: planName,
              amount: {
                currency_code: currency,
                value: amount.toFixed(2),
              },
            },
          ],
        }),
      }
    );

    const order = await response.json();

    if (!response.ok) {
      throw new Error(order.message || "Order creation failed");
    }

    // Store order in database for tracking
    const db = client.db('Interest');
    const ordersCollection = db.collection('orders');

    await ordersCollection.insertOne({
      orderId: order.id,
      userId: req.user._id,
      userEmail: req.user.email,
      amount: amount * 100, // keep consistent with Razorpay (paise/cents)
      currency: currency,
      planName: planName,
      status: 'created',
      provider: 'paypal',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    res.json({ order });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Order creation failed" });
  }
});

/* =========================
   CAPTURE PAYMENT
========================= */
router.post("/verify-payment-paypal", authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Order ID missing" });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    if (data.status !== "COMPLETED") {
      return res.status(400).json({ error: "Payment not completed" });
    }

    // ✅ SUCCESS POINT
    const db = client.db('Interest');
    const ordersCollection = db.collection('orders');
    const paymentsCollection = db.collection('payments');
    const usersCollection = db.collection('users');

    const transactionId = data.purchase_units[0].payments.captures[0].id;

    // Fetch the order to get the planName
    const order = await ordersCollection.findOne({ orderId: orderId });
    const planName = order?.planName || req.body.planName || 'Professional';
    const plan = PLAN_CONFIG[planName] || PLAN_CONFIG['Professional'];

    // Update order status
    await ordersCollection.updateOne(
      { orderId: orderId },
      {
        $set: {
          status: 'paid',
          paymentId: transactionId,
          updatedAt: new Date()
        }
      }
    );

    // Store payment details
    await paymentsCollection.insertOne({
      orderId: orderId,
      paymentId: transactionId,
      status: 'verified',
      provider: 'paypal',
      data: data,
      createdAt: new Date()
    });

    // Add credits with expiry based on plan
    await usersCollection.updateOne(
      { _id: req.user._id },
      {
        $push: {
          credits: {
            amount: plan.credits,
            expiresAt: new Date(Date.now() + plan.validityDays * 24 * 60 * 60 * 1000),
            createdAt: new Date()
          }
        },
        $set: { isPremium: true }
      }
    );

    res.json({
      success: true,
      transactionId: transactionId,
      message: `Payment verified successfully and ${plan.credits} credits added`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Payment capture failed" });
  }
});

// Verify Payment Signature
router.post('/verify-payment', authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId, // For Generic/PayPal
      paymentId, // For Generic/PayPal
      provider
    } = req.body;

    const db = client.db('Interest');
    const ordersCollection = db.collection('orders');
    const paymentsCollection = db.collection('payments');
    const usersCollection = db.collection('users');

    let isVerified = false;
    let finalOrderId = razorpay_order_id || orderId;
    let finalPaymentId = razorpay_payment_id || paymentId;

    if (razorpay_signature) {
      const sign = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSign = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(sign)
        .digest("hex");
      isVerified = (expectedSign === razorpay_signature);
    } else if (provider === 'paypal') {
      // For PayPal proxy, we assume it's pre-verified
      isVerified = true;
    }

    if (!isVerified || !finalOrderId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment verification or missing order ID'
      });
    }

    // Process successful payment
    // 1. Update order status
    await ordersCollection.updateOne(
      { orderId: finalOrderId },
      {
        $set: {
          status: 'paid',
          paymentId: finalPaymentId,
          updatedAt: new Date()
        }
      }
    );

    // 2. Store payment details
    await paymentsCollection.insertOne({
      orderId: finalOrderId,
      paymentId: finalPaymentId,
      signature: razorpay_signature || null,
      provider: provider || 'razorpay',
      status: 'verified',
      createdAt: new Date()
    });

    // 3. Add credits based on plan
    const order = await ordersCollection.findOne({ orderId: finalOrderId });
    // Plan name can be in order.planName or order.notes.planName
    const planName = order?.planName || order?.notes?.planName || req.body.planName || 'Professional';
    const plan = PLAN_CONFIG[planName] || PLAN_CONFIG['Professional'];

    // Identify user to credit
    const userIdToCredit = order?.userId ? (typeof order.userId === 'string' ? new ObjectId(order.userId) : order.userId) : req.user._id;

    await usersCollection.updateOne(
      { _id: userIdToCredit },
      {
        $push: {
          credits: {
            amount: plan.credits,
            expiresAt: new Date(Date.now() + plan.validityDays * 24 * 60 * 60 * 1000),
            createdAt: new Date()
          }
        },
        $set: { isPremium: true }
      }
    );

    res.status(200).json({
      success: true,
      message: `Payment verified successfully and ${plan.credits} credits added`
    });

  } catch (err) {
    console.error('Error verifying payment:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get Payment Details
router.get('/payment-details/:paymentId', authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await razorpay.payments.fetch(paymentId);
    res.json({
      success: true,
      payment
    });
  } catch (error) {
    console.error('Error fetching payment details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details',
      error: error.message
    });
  }
});

// Get Order Details
router.get('/order-details/:orderId', authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await razorpay.orders.fetch(orderId);
    res.json({
      success: true,
      order
    });
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order details',
      error: error.message
    });
  }
});

// Refund Payment (Admin only - add role check if needed)
router.post('/refund', authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const { paymentId, amount } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: 'Payment ID is required'
      });
    }

    const refundOptions = amount ? { amount: amount * 100 } : {};
    const refund = await razorpay.payments.refund(paymentId, refundOptions);

    // Update payment status in database
    const db = client.db('Interest');
    const paymentsCollection = db.collection('payments');
    const refundsCollection = db.collection('refunds');

    await paymentsCollection.updateOne(
      { paymentId },
      { $set: { status: 'refunded', updatedAt: new Date() } }
    );

    await refundsCollection.insertOne({
      paymentId,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
      createdAt: new Date()
    });

    res.json({
      success: true,
      refund
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({
      success: false,
      message: 'Refund failed',
      error: error.message
    });
  }
});

// Get User's Orders
router.get('/orders', authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const db = client.db('Interest');
    const ordersCollection = db.collection('orders');

    // Only get orders for the authenticated user
    const orders = await ordersCollection
      .find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      orders
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});

// Get User's Payments
router.get('/payments', authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const db = client.db('Interest');
    const paymentsCollection = db.collection('payments');
    const ordersCollection = db.collection('orders');

    // Get user's orders first
    const userOrders = await ordersCollection
      .find({ userId: req.user._id })
      .toArray();

    const orderIds = userOrders.map(order => order.orderId);

    // Get payments for user's orders
    const payments = await paymentsCollection
      .find({ orderId: { $in: orderIds } })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      payments
    });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payments',
      error: error.message
    });
  }
});

export default router;
