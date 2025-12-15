const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { client } = require('./db/connect');
const authMiddleware = require('./middleware/authMiddleware');

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
        const ObjectId = require('mongodb').ObjectId;

        // Get the order to find user information
        const order = await ordersCollection.findOne({ orderId: razorpay_order_id });

        if (order && order.userId) {
          // Convert userId to ObjectId if it's a string
          const userId = typeof order.userId === 'string' ? new ObjectId(order.userId) : order.userId;

          await usersCollection.updateOne(
            { _id: userId },
            {
              $inc: { credits: 250 },
              $set: { premium: true }
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

module.exports = router;
