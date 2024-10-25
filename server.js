const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const {WebSocketServer} = require('ws');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'secretkey';
const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect('mongodb+srv://irshadhussain7881:h%40sh@cluster017.pih9e1e.mongodb.net/hello')
  .then(() => {  console.log('Connected to MongoDB'); }).catch((error) => { console.error('Error connecting to MongoDB:', error); });

const rowLength = 999;
const columnLength = 27;

const cellSchema = new mongoose.Schema({
  name:String,
  date: {
      type: Date,
      default: Date.now,
      // unique: true
  },
  cells: {
    type: [[String]],
    default: () => Array.from({ length: rowLength }, () => Array(columnLength).fill(''))
  },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User'},
  collaborators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User'}],
});

const Cell = mongoose.model('Cell', cellSchema);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  spreadsheet:[{type: mongoose.Schema.Types.ObjectId, ref: 'Cell'}],
});

const User = mongoose.model('User', userSchema);

//MIDDLEWARE
const authUser = async (req, res, next) => {
  try {
    const token = req.header('Authorization').split(' ')[2];
    const data = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ username: data.username });
    if (!user) {
      throw new Error();
    }
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Not authorized to access this resource' });
    console.log(error);
  }
};
// Hii
app.get('/', async(req,resp)=>{
  return resp.json({
    message: "hii from Deployed"
  })
}) 
//SIGN-UP
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.findOne({ username });
    if (user) {
      res.status(400).json({ error: 'Username already exists' });
      return;
    }
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    const token = jwt.sign({ userId: newUser._id }, JWT_SECRET);
    // res.json({ message: 'Login successful', token: token });
    res.json({ message: 'User registered successfully', token: token  });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});
//LOG-IN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username});
    if (!user) {
      res.status(400).json({ error: 'Invalid username or password' });
      return;
    }
    if (await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ username , userId: user._id }, JWT_SECRET);
      res.json({ message: 'Login successful', token: token });
    } else {
      res.status(400).json({ error: 'Invalid username or password' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to login' });
  }
});
// DETAILS EXCEPT PASSWORD
app.get('/api/user/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    const user = await User.findById(id).populate('spreadsheet');
    user.password = undefined;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});
// GETTING EMAILS----
app.get('/api/emails', async(req,resp)=>{
  try{
    const response = await User.find()
    if(response){
      resp.status(200).json({
        msg: "Successfully gettin emails",
        data: response
      })
    }
  }catch(err){
    resp.status(500).json({
      msg: "Error",
      err: err
    })
  }
})
// SHARING-SHEET-
app.post('/api/user/share', async(req,resp)=>{
  const { sheetId, email } = req.body
  try{
    const shareTo = await User.findOne({
        email
    })
    if(!shareTo){
        return resp.status(404).json({ message: "Email does not exist in the database" });
    }
    console.log(shareTo)
    const shareBy = await User.findOne({
      'spreadsheet._id': sheetId
    })
    if(!shareBy){
      return resp.status(401).json({ message: "Sheet not found for the given ID" });
    }
    console.log(shareBy)
    console.log(`Adding sheet ${sheetId} to collaborator ${email} again`);
    const shareBySheets = shareBy.spreadsheet.find(sheet => sheet._id === sheetId)
    shareTo.spreadsheet.push({
      _id: sheetId
    })
    await shareTo.save()
    resp.status(200).json({ message: "Successfully added collaborator again" });
  } catch (error) {
    resp.status(500).json({ message: "Error adding collaborator" });
    console.error("Error adding collaborator:", error);
  }
})

app.post('/api/add-collaborator', async (req, res) => {
  const { spreadsheetId, collaboratorUsername } = req.body;

  if (!spreadsheetId || !collaboratorUsername) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cell = await Cell.findById(spreadsheetId).session(session);
    if (!cell) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Spreadsheet not found' });
    }

    const user = await User.findOne({ username: collaboratorUsername }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'User not found' });
    }

    if (!cell.collaborators.includes(user._id)) {
      cell.collaborators.push(user._id);
    }

    if (!user.spreadsheet.includes(spreadsheetId)) {
      user.spreadsheet.push(spreadsheetId);
    }

    await cell.save({ session });
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: 'Collaborator added successfully' });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);
    res.status(500).json({ error: 'Failed to add collaborator' });
  }
});

app.post('/api/spreadsheet', async (req, res) => {
  try {
    const {name, owner} = req.body;
    const newCellData = new Cell({name, owner});
    const user = await User.findById(owner);
    user.spreadsheet.push(newCellData._id);
    await newCellData.save();
    await user.save();
    res.json({ id: newCellData._id });
  } catch (error) {
    res.status(500).json({ error: `Failed to create spreadsheet ${error} ` });
  }
});

app.get('/api/spreadsheet/:id',authUser, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid spreadsheet ID' });
    }
    let cellData = await Cell.findById(id).populate('owner').populate('collaborators');
    if (!cellData) {
      res.status(404).json({ error: 'Spreadsheet not found' });
    }
    res.json(cellData.cells);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve spreadsheet' });
  }
});

app.get('/delete/:userDel', async (req,resp)=>{
  const {sheetId} = req.query
  const {userDel} = req.params
  try{
    const data = await User.findById({userDel})
    // const sheet = await data.spreadsheet({
    //   'spreadsheet._id': sheetId
    // })
    console.log('Deleting sheet:', sheetId, 'for user:', userDel);
    // Perform the deletion
    const sheet = await data.updateOne(
        { _id: userDel, 'spreadSheets._id': sheetId },
        { $pull: { spreadSheets: { _id: sheetId } } }
    );
    console.log('Update result:', sheet);
    if (sheet.nModified > 0) {
        resp.status(200).json({ message: 'Sheet deleted successfully' });
    } else {
        resp.status(404).json({ message: 'Sheet not found' });
    }
  }catch(err){
    resp.status(500).json({
      msg: "Not deleted",
    })
  }
})

app.post('/api/spreadsheet/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid spreadsheet ID' });
    }
    const { cells } = req.body;
    await Cell.findByIdAndUpdate(id, { cells });
    res.sendStatus(200);

    wsServer.clients.forEach((client) => {
      if (client != ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', id, cells }));
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update spreadsheet' });
  }
});


const server = http.createServer(app);
const wsServer = new WebSocketServer({ server });

wsServer.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const spreadsheetId = url.searchParams.get('spreadsheetId');
  const clientId = url.searchParams.get('clientId');

  ws.on('message', (message) => {
    const { type, row, col, value } = JSON.parse(message);

    if (type === 'update') {
      Cell.findById(spreadsheetId).then((cellData) => {
        if (cellData) {
          cellData.cells[row][col] = value;
          cellData.save().then(() => {
            wsServer.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'update', id: spreadsheetId, cells: cellData.cells }));
              }
            });
          });
        }
      }).catch((error) => {
        console.error('Error updating cell data:', error);
      });
    } else if (type === 'select') {
      const selectedCell = { row, col };
      wsServer.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'select', id: spreadsheetId, selectedCell }));
        }
      });
    }
  });

  Cell.findById(spreadsheetId).then((cellData) => {
    ws.send(
      JSON.stringify({ type: 'init', id: spreadsheetId, cells: cellData ? cellData.cells : 'Spreadsheet not found' })
    );
  }).catch((error) => {
    console.error('Error initializing WebSocket:', error);
  });
});

server.listen(5000, () => {
  console.log('Server running on port 5000');
});
