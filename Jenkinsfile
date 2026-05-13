pipeline {
    agent any
    triggers {
        cron('TZ=Asia/Kolkata\n0 7,12,18 * * *')
    }
    environment {
    PATH = "/usr/local/bin:${env.PATH}"
    NAUKRI_USERNAME = credentials('NAUKRI_EMAIL')
    NAUKRI_PASSWORD = credentials('NAUKRI_PASSWORD')
}
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }
        stage('Upload Resume') {
            steps {
                sh 'node NaukriResumeScript.js'
            }
        }
    }
    post {
        success {
            echo "✅ Resume uploaded at ${new Date()}"
        }
        failure {
            echo "❌ Upload failed at ${new Date()}"
        }
    }
}