const usermodel = require('../models/UserModel');

exports.createUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const newUser = await usermodel.create({ name, email, password });
        res.status(201).json({
            status: 'success',
            data: {
                user: newUser
            }
        });
    } catch (error) {
        res.status(400).json({
            status: 'fail',
            message: "User creation failed: " + error.message
        });
    }
}

exports.getAllUsers = async (req, res) => {
    try {
        const users = await usermodel.find();
        res.status(200).json({
            status: 'success',
            results: users.length,
            data: {
                users
            }
        });
    } catch (error) {
        res.status(400).json({
            status: 'fail',
            message: error.message
        });
    }
}

exports.getUserById = async (req, res) => { 
    try {
        const user = await usermodel.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }
        res.status(200).json({
            status: 'success',
            data: {
                user
            }
        });
    } catch (error) {
        res.status(400).json({
            status: 'fail',
            message: error.message
        });
    }
}

exports.updateUser = async (req, res) => {
    try {
        const user = await usermodel.findByIdAndUpdate(req.params.id
            , req.body, { new: true, runValidators: true });
        if (!user) {
            return res.status(404).json({   
                status: 'fail',
                message: 'User not found'
            });
        }
        res.status(200).json({
            status: 'success',
            data: {
                user
            }
        });
    } catch (error) {
        res.status(400).json({
            status: 'fail',
            message: error.message
        });
    }
}

exports.deleteUser = async (req, res) => {  
    try {
        const user = await usermodel.findByIdAndDelete(req.params.id);
        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }
        res.status(204).json({
            status: 'success',
            data: null
        });
    }catch (error) {
        res.status(400).json({
            status: 'fail', 
            message: error.message
        });
    }
}