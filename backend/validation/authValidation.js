const Joi = require('joi');

const registerSchema = Joi.object({
  name: Joi.string()
    .pattern(/^[a-zA-Z0-9 .'-]+$/)
    .min(2).max(100)
    .required()
    .messages({
      'string.pattern.base': 'Name can only contain letters, spaces, and basic punctuation.',
    }),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('User', 'Hospital', 'Blood Bank', 'Admin').required(),
  bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').optional().allow(''),
  contact: Joi.string().optional().allow(''),
  age: Joi.number().optional().allow('', null),
  latitude: Joi.number().min(-90).max(90).optional().allow('', null),
  longitude: Joi.number().min(-180).max(180).optional().allow('', null)
}).options({ allowUnknown: true, stripUnknown: true }); // Allow extra fields silently

const loginSchema = Joi.object({
  email: Joi.string().required(),
  password: Joi.string().required()
}).options({ allowUnknown: true, stripUnknown: true }); // Strip unknown keys

const validateRequestContext = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    res.status(400);
    return next(new Error(error.details[0].message));
  }
  next();
};

module.exports = {
  registerSchema,
  loginSchema,
  validateRequestContext
};
