const express = require('express');
const redis = require('redis');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 60000,
    lazyConnect: true
  }
});

// Connect to Redis
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connected to Redis'));

const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log('Redis connected successfully');
    
    // Initialize demo licenses
    await initializeDemoLicenses();
  } catch (err) {
    console.error('Redis connection failed:', err);
    process.exit(1);
  }
};

connectRedis();

// Utility functions
const generateLicenseKey = () => {
  return 'PHANTOM-' + Math.random().toString(36).substr(2, 9).toUpperCase();
};

const getLicenseKey = (license) => `license:${license}`;
const getHWIDKey = (hwid) => `hwid:${hwid}`;

// Initialize demo licenses
const initializeDemoLicenses = async () => {
  try {
    const demoLicenses = [
      { 
        key: 'PHANTOM-123456789', 
        maxActivations: 1, 
        expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000) 
      },
      { 
        key: 'PHANTOM-ABCDEFGHI', 
        maxActivations: 1, 
        expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000) 
      },
      { 
        key: 'TEST-LICENSE-123', 
        maxActivations: 5, 
        expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000) 
      }
    ];

    for (const license of demoLicenses) {
      const licenseKey = getLicenseKey(license.key);
      const exists = await redisClient.exists(licenseKey);
      
      if (!exists) {
        await redisClient.hSet(licenseKey, {
          key: license.key,
          maxActivations: license.maxActivations,
          currentActivations: 0,
          createdAt: Date.now(),
          expiresAt: license.expiresAt,
          isActive: 1
        });
        console.log(`✅ Created demo license: ${license.key}`);
      }
    }
    console.log('✅ Demo licenses initialized');
  } catch (err) {
    console.error('❌ Error initializing demo licenses:', err);
  }
};

// Validation endpoint
app.post('/validate', async (req, res) => {
  try {
    const { license_key, hwid, version } = req.body;

    if (!license_key || !hwid) {
      return res.json({ success: false, error: 'Missing license key or HWID' });
    }

    const licenseKey = getLicenseKey(license_key);
    const licenseData = await redisClient.hGetAll(licenseKey);

    if (!licenseData || !licenseData.key) {
      return res.json({ success: false, error: 'Invalid license key' });
    }

    // Check if license is active
    if (licenseData.isActive === '0') {
      return res.json({ success: false, error: 'License deactivated' });
    }

    // Check expiration
    const expiresAt = parseInt(licenseData.expiresAt);
    if (Date.now() > expiresAt) {
      return res.json({ success: false, error: 'License expired' });
    }

    const maxActivations = parseInt(licenseData.maxActivations);
    const currentActivations = parseInt(licenseData.currentActivations);

    // Check HWID associations
    const hwidKey = getHWIDKey(hwid);
    const hwidLicense = await redisClient.get(hwidKey);

    if (hwidLicense) {
      if (hwidLicense === license_key) {
        return res.json({ 
          success: true, 
          message: 'License validated successfully',
          expires_at: new Date(expiresAt).toISOString()
        });
      } else {
        return res.json({ success: false, error: 'HWID already registered with different license' });
      }
    }

    // Check activation limit
    if (currentActivations >= maxActivations) {
      return res.json({ success: false, error: 'Maximum activations reached' });
    }

    // First-time activation
    await redisClient.set(hwidKey, license_key);
    await redisClient.hIncrBy(licenseKey, 'currentActivations', 1);
    
    // Store activation log
    const activationKey = `activation:${license_key}:${Date.now()}`;
    await redisClient.hSet(activationKey, {
      license: license_key,
      hwid: hwid,
      timestamp: Date.now(),
      ip: req.ip,
      userAgent: req.get('User-Agent') || 'C++ Client'
    });

    await redisClient.expire(activationKey, 30 * 24 * 60 * 60);

    res.json({ 
      success: true, 
      message: 'License activated successfully',
      expires_at: new Date(expiresAt).toISOString()
    });

  } catch (err) {
    console.error('Validation error:', err);
    res.json({ success: false, error: 'Server error' });
  }
});

// Check license status
app.post('/check', async (req, res) => {
  try {
    const { license_key, hwid } = req.body;

    if (!license_key || !hwid) {
      return res.json({ success: false, error: 'Missing parameters' });
    }

    const licenseKey = getLicenseKey(license_key);
    const licenseData = await redisClient.hGetAll(licenseKey);

    if (!licenseData || !licenseData.key) {
      return res.json({ success: false, error: 'Invalid license' });
    }

    // Verify HWID association
    const hwidKey = getHWIDKey(hwid);
    const associatedLicense = await redisClient.get(hwidKey);

    if (associatedLicense !== license_key) {
      return res.json({ success: false, error: 'HWID not associated with this license' });
    }

    // Check expiration
    const expiresAt = parseInt(licenseData.expiresAt);
    if (Date.now() > expiresAt) {
      return res.json({ success: false, error: 'License expired' });
    }

    res.json({ 
      success: true, 
      message: 'License is valid',
      expires_at: new Date(expiresAt).toISOString()
    });

  } catch (err) {
    console.error('Check error:', err);
    res.json({ success: false, error: 'Server error' });
  }
});

// Admin: Create new license
app.post('/admin/create', async (req, res) => {
  try {
    const { admin_key, max_activations = 1, days_valid = 30 } = req.body;

    if (admin_key !== process.env.ADMIN_KEY) {
      return res.json({ success: false, error: 'Unauthorized' });
    }

    const licenseKey = generateLicenseKey();
    const fullKey = getLicenseKey(licenseKey);
    const expiresAt = Date.now() + (days_valid * 24 * 60 * 60 * 1000);

    await redisClient.hSet(fullKey, {
      key: licenseKey,
      maxActivations: max_activations,
      currentActivations: 0,
      createdAt: Date.now(),
      expiresAt: expiresAt,
      isActive: 1
    });

    res.json({ 
      success: true, 
      license_key: licenseKey,
      expires_at: new Date(expiresAt).toISOString(),
      max_activations: max_activations
    });

  } catch (err) {
    console.error('Create license error:', err);
    res.json({ success: false, error: 'Server error' });
  }
});

// Admin: Get all licenses
app.get('/admin/licenses', async (req, res) => {
  try {
    const { admin_key } = req.query;

    if (admin_key !== process.env.ADMIN_KEY) {
      return res.json({ success: false, error: 'Unauthorized' });
    }

    const keys = await redisClient.keys('license:*');
    const licenses = [];

    for (const key of keys) {
      const licenseData = await redisClient.hGetAll(key);
      licenses.push(licenseData);
    }

    res.json({ success: true, licenses });

  } catch (err) {
    console.error('Get licenses error:', err);
    res.json({ success: false, error: 'Server error' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ 
      success: true, 
      message: 'Server and Redis are healthy',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Redis connection failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Phantom Auth Server running on port ${PORT}`);
});
