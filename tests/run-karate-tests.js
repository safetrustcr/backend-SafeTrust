const { exec } = require("child_process");
const path = require("path");

// Path to the Karate JAR file
const karateJarPath = path.join(__dirname, "../karate.jar");

// Path to the Karate features directory
const featuresPath = path.join(__dirname, "../karate/features");

// Command to run Karate tests
const command = `java -jar ${karateJarPath} ${featuresPath}`;

// Execute the command
exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error executing Karate tests: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`Error output: ${stderr}`);
    return;
  }
  console.log(`Karate test output:\n${stdout}`);
});
