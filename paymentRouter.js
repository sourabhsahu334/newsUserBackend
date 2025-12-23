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

    // Add 250 credits with 30 days expiry
    await usersCollection.updateOne(
      { _id: req.user._id },
      {
        $push: {
          credits: {
            amount: 250,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date()
          }
        },
        $set: { isPremium: true }
      }
    );

    res.json({
      success: true,
      transactionId: transactionId,
      message: 'Payment verified successfully and credits added'
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
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters'
      });
    }

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest("hex");

    if (expectedSign === razorpay_signature) {
      // Update order status in database
      const db = client.db('Interest');
      const ordersCollection = db.collection('orders');
      const paymentsCollection = db.collection('payments');

      // Update order status
      await ordersCollection.updateOne(
        { orderId: razorpay_order_id },
        {
          $set: {
            status: 'paid',
            paymentId: razorpay_payment_id,
            updatedAt: new Date()
          }
        }
      );

      // Store payment details
      await paymentsCollection.insertOne({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        status: 'verified',
        createdAt: new Date()
      });

      // Increment user credits by 250
      try {
        const usersCollection = db.collection('users');

        // Get the order to find user information
        const order = await ordersCollection.findOne({ orderId: razorpay_order_id });

        if (order && order.userId) {
          // Convert userId to ObjectId if it's a string
          const userId = typeof order.userId === 'string' ? new ObjectId(order.userId) : order.userId;

          await usersCollection.updateOne(
            { _id: userId },
            {
              $push: {
                credits: {
                  amount: 250,
                  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                  createdAt: new Date()
                }
              },
              $set: { isPremium: true }
            }
          );

          console.log(`Credits incremented by 250 for user: ${order.userId}`);
        } else {
          console.warn('No userId found in order for credit increment.');
        }
      } catch (creditError) {
        console.error('Error incrementing user credits:', creditError);
        // Continue with payment verification even if credit increment fails
      }

      return res.status(200).json({
        success: true,
        message: 'Payment verified successfully and credits added'
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature'
      });
    }
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
