CREATE DATABASE IF NOT EXISTS portal_atividades CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE portal_atividades;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('root','student') NOT NULL DEFAULT 'student',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(140) NOT NULL,
  description TEXT NOT NULL,
  due_date DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activities_due (due_date)
);

CREATE TABLE IF NOT EXISTS submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  activity_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  grade DECIMAL(5,2) NULL,
  feedback VARCHAR(1000) NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  graded_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_activity_student (activity_id, student_id),
  CONSTRAINT fk_submission_activity FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  CONSTRAINT fk_submission_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_submission_student (student_id),
  INDEX idx_submission_grade (grade)
);
