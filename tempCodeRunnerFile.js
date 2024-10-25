app.post('/api/spreadsheet', async (req, res) => {
  try {
    const {name, owner} = req.body;
    const newCellData = new Cell({name, owner});
    const user = await User.findOne({username:owner});
    user.spreadsheet.push(newCellData._id);
    await newCellData.save();
    await user.save();
    res.json({ id: newCellData._id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create spreadsheet' });
  }