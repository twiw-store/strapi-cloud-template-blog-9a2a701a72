module.exports = ({ env }) => {
  const url = env('DATABASE_URL');
  if (url) return { connection:{ client:'postgres', connection:url, pool:{min:2,max:10}, acquireConnectionTimeout:60000 }};
  return { connection:{ client:'sqlite', connection:{ filename: env('DATABASE_FILENAME','.tmp/data.db') }, useNullAsDefault:true }};
};
