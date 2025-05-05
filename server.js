const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;
const upload = multer(); // in-memory file storage

// Azure SQL config
const config = {
  user: 'stevenmahlman',
  password: 'Lcshs12301!^',
  server: 'websystems2db.database.windows.net',
  database: 'WebSystemsIIDataBase',
  options: {
    encrypt: true,
    enableArithAbort: true
  }
};

// Connect to SQL
sql.connect(config)
  .then(() => console.log('✅ Connected to Azure SQL Database!'))
  .catch(err => console.error('❌ SQL connection error:', err));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🔐 LOGIN ROUTE
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .query('SELECT UserID, PasswordHash, FirstName, LastName FROM Users WHERE Username = @username');

    if (result.recordset.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const user = result.recordset[0];
    const passwordMatch = await bcrypt.compare(password, user.PasswordHash);
    const isAdmin = (username.toLowerCase() === 'admin');

    if (passwordMatch) {
      res.json({
        success: true,
        message: 'Login successful!',
        userID: user.UserID,
        firstName: user.FirstName,
        lastName: user.LastName,
        isAdmin: isAdmin
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// 📝 SIGNUP ROUTE
app.post('/signup', async (req, res) => {
  const { username, password, firstName, lastName } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const pool = await sql.connect(config);
    await pool.request()
      .input('username', sql.NVarChar, username)
      .input('passwordHash', sql.NVarChar, hashedPassword)
      .input('firstName', sql.NVarChar, firstName)
      .input('lastName', sql.NVarChar, lastName)
      .query(`
        INSERT INTO Users (Username, PasswordHash, FirstName, LastName)
        VALUES (@username, @passwordHash, @firstName, @lastName)
      `);

    res.json({ success: true, message: 'Account created successfully!' });
  } catch (err) {
    console.error('❌ Sign-up error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// 🎨 UPLOAD ART PIECE
app.post('/artpieces', upload.single('art-image'), async (req, res) => {
  const { title, description, price, dateMade, dateAdded, userID } = req.body;
  const imageBuffer = req.file?.buffer;

  if (!imageBuffer) {
    return res.status(400).json({ success: false, message: 'No image uploaded.' });
  }

  try {
    const pool = await sql.connect(config);
    await pool.request()
      .input('name', sql.NVarChar, title)
      .input('description', sql.NVarChar, description)
      .input('price', sql.Decimal(10, 2), parseFloat(price))
      .input('dateMade', sql.Date, dateMade)
      .input('dateAdded', sql.DateTime, dateAdded)
      .input('imageData', sql.VarBinary(sql.MAX), imageBuffer)
      .input('userID', sql.Int, userID)
      .query(`
        INSERT INTO ArtPieces (Name, Description, Price, DateMade, DateAdded, ImageData, Status, UserID)
        VALUES (@name, @description, @price, @dateMade, @dateAdded, @imageData, 'Available', @userID)
      `);

    res.json({ success: true, message: 'Art uploaded successfully!' });
  } catch (err) {
    console.error('❌ Art upload error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// 🖼️ FETCH IMAGE
app.get('/artpieces/image/:id', async (req, res) => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT ImageData FROM ArtPieces WHERE ArtID = @id');

    const image = result.recordset[0]?.ImageData;
    if (!image) return res.status(404).send('Image not found');

    res.set('Content-Type', 'image/jpeg');
    res.send(image);
  } catch (err) {
    console.error('❌ Image fetch error:', err);
    res.status(500).send('Server error');
  }
});

// 🎨 FETCH DELETED ART PIECES — ADMIN ONLY
app.get('/artpieces/deleted', async (req, res) => {
  const isAdmin = req.query.isAdmin === 'true';
  if (!isAdmin) {
    return res.status(403).json({ message: 'Access denied. Admins only.' });
  }

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .query(`
        SELECT ArtID, Name, Description, Price, DateMade, DateAdded, UserID
        FROM ArtPieces
        WHERE Status = 'Deleted'
        ORDER BY DateAdded DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error fetching deleted artworks:', err);
    res.status(500).send('Server error');
  }
});

// FETCH SINGLE ART
app.get('/artpieces/:id', async (req, res) => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM ArtPieces WHERE ArtID = @id');

    if (result.recordset.length === 0) {
      return res.status(404).send('Art piece not found');
    }

    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Error loading artwork:', error);
    res.status(500).send('Server error');
  }
});

// UPDATE ART
app.put('/artpieces/:id', async (req, res) => {
  const { id } = req.params;
  const { description, price, dateMade, dateAdded } = req.body;

  try {
    const pool = await sql.connect(config);
    await pool.request()
      .input('id', sql.Int, id)
      .input('description', sql.NVarChar, description)
      .input('price', sql.Decimal(10, 2), price)
      .input('dateMade', sql.Date, dateMade)
      .input('dateAdded', sql.DateTime, dateAdded)
      .query(`
        UPDATE ArtPieces
        SET Description = @description,
            Price = @price,
            DateMade = @dateMade,
            DateAdded = @dateAdded
        WHERE ArtID = @id
      `);

    res.send('Artwork updated successfully');
  } catch (error) {
    console.error('Error updating artwork:', error);
    res.status(500).send('Server error');
  }
});

// DELETE ART
app.delete('/artpieces/:id', async (req, res) => {
  const { id } = req.params;
  const { userID, isAdmin } = req.body;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT UserID FROM ArtPieces WHERE ArtID = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Artwork not found.' });
    }

    const ownerID = result.recordset[0].UserID;
    if (!isAdmin && userID != ownerID) {
      return res.status(403).json({ message: 'Unauthorized: Only the owner or admin can delete.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query(`UPDATE ArtPieces SET Status = 'Deleted' WHERE ArtID = @id`);

    res.json({ message: 'Artwork soft-deleted successfully.' });
  } catch (error) {
    console.error('Error deleting artwork:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// RESTORE ART
app.put('/artpieces/restore/:id', async (req, res) => {
  const { id } = req.params;
  const { userID, isAdmin } = req.body;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT UserID FROM ArtPieces WHERE ArtID = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Artwork not found.' });
    }

    const ownerID = result.recordset[0].UserID;
    if (!isAdmin && userID != ownerID) {
      return res.status(403).json({ message: 'Unauthorized: Only the owner or admin can restore.' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query(`UPDATE ArtPieces SET Status = 'Available' WHERE ArtID = @id`);

    res.json({ message: 'Artwork restored successfully.' });
  } catch (error) {
    console.error('Error restoring artwork:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// FETCH ALL NON-DELETED ART
app.get('/artpieces', async (req, res) => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .query(`
        SELECT ArtID, Name, Description, Price, DateMade, DateAdded, UserID
        FROM ArtPieces
        WHERE Status != 'Deleted'
        ORDER BY DateAdded DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching gallery:', err);
    res.status(500).send('Server error');
  }
});


app.listen(port, () => {
  console.log(` Server running at http://localhost:${port}`);
});
