const { resolveSecret } = require('./secrets');

module.exports = {
    jwt: {
      secretKey: resolveSecret('JWT_SECRET'),
    },
    defaults: {
      userimage: 'https://www.shutterstock.com/image-vector/default-avatar-profile-icon-social-600nw-1906669723.jpg',
    }
  };
  