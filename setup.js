// Setup script for first-time users
const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🎉 TikTok Bot Setup Wizard\n');

const questions = [
  { name: 'BOT_TOKEN', question: 'Enter your Telegram Bot Token: ' },
  { name: 'BOT_USERNAME', question: 'Enter your bot username (with @): ' },
  { name: 'API_BASE_URL', question: 'Enter TikTok API URL: ', default: 'https://zorouchiha.serv00.net/tiktok/api.php' },
  { name: 'ADMIN_IDS', question: 'Enter admin IDs (comma separated): ' },
  { name: 'PORT', question: 'Enter port number: ', default: '3000' }
];

let answers = {};

function askQuestion(index) {
  if (index >= questions.length) {
    createEnvFile();
    return;
  }

  const q = questions[index];
  rl.question(q.question, (answer) => {
    answers[q.name] = answer || q.default || '';
    askQuestion(index + 1);
  });
}

function createEnvFile() {
  const envContent = Object.keys(answers)
    .map(key => `${key}=${answers[key]}`)
    .join('\n');

  fs.writeFileSync('.env', envContent);
  console.log('\n✅ .env file created successfully!');
  console.log('\nNext steps:');
  console.log('1. npm install');
  console.log('2. npm run dev');
  rl.close();
}

askQuestion(0);
