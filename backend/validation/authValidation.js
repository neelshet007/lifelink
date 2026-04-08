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
}).options({ allowUnknown: true, stripUnknown: true });

const loginSchema = Joi.object({
  email: Joi.string().required(),
  password: Joi.string().required()
}).options({ allowUnknown: true, stripUnknown: true });

const gatewayLoginSchema = Joi.object({
  identityType: Joi.string().valid('ABHA', 'HFR', 'DCGI').required(),
  identifier: Joi.string().trim().min(3).required(),
  declarationAccepted: Joi.boolean().valid(true).required(),
}).options({ allowUnknown: true, stripUnknown: true });

const mockAbhaRegisterSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  aadhaar: Joi.string().pattern(/^\d{12}$/).required(),
  email: Joi.string().email().required(),
  dob: Joi.string().required(),
  gender: Joi.string().valid('male', 'female', 'other').required(),
  currentRegion: Joi.string().valid('north-zone', 'south-zone', 'west-zone', 'east-zone', 'central-zone').optional().default('south-zone'),
}).options({ allowUnknown: true, stripUnknown: true });

const completeProfileSchema = Joi.object({
  bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').required(),
  verificationSourceId: Joi.string().trim().required(),
}).options({ allowUnknown: true, stripUnknown: true });

const facilityOnboardingSchema = Joi.object({
  facilityName: Joi.string().min(3).max(140).required(),
  category: Joi.string().valid('Hospital', 'Blood Bank').required(),
  governmentRegNo: Joi.string().trim().min(4).max(60).required(),
  administratorAadhaar: Joi.string().pattern(/^\d{12}$/).required(),
  email: Joi.string().email().required(),
}).options({ allowUnknown: true, stripUnknown: true });

const updateLocationSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
}).options({ allowUnknown: true, stripUnknown: true });

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
  gatewayLoginSchema,
  mockAbhaRegisterSchema,
  completeProfileSchema,
  facilityOnboardingSchema,
  updateLocationSchema,
  validateRequestContext
};
